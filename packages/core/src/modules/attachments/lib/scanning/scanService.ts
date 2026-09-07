import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Attachment, type AttachmentScanStatus } from '../../data/entities'
import type { StorageDriver } from '../drivers/types'
import { resolveAttachmentScanner, type AttachmentScanner, type ScanVerdict } from './index'

const logger = createLogger('attachments').child({ component: 'scan' })

/**
 * Running a scan and recording what it said.
 *
 * The verdict is written to the row rather than returned to the uploader,
 * because the row is what every reader consults. A caller that acted on a
 * return value would be one code path deciding for all of them, which is the
 * shape the access check already exists to prevent.
 */

export type ScanOutcome = {
  status: AttachmentScanStatus
  scanner: string
  signature?: string | null
}

/** Only `clean` is readable; both failure shapes stay closed. */
export function isReadableScanStatus(status: AttachmentScanStatus | null | undefined): boolean {
  return status === 'clean'
}

function statusFor(verdict: ScanVerdict): AttachmentScanStatus {
  if (verdict.status === 'clean') return 'clean'
  if (verdict.status === 'infected') return 'infected'
  return 'failed'
}

/**
 * Scan one attachment and persist the verdict.
 *
 * Reads the bytes through the storage driver rather than trusting anything the
 * client said about them: the file that gets scanned has to be the file that
 * will be served, and the only version of it that matters is the one in
 * storage.
 */
export async function scanAttachment(
  em: EntityManager,
  attachment: Attachment,
  driver: StorageDriver,
  scanner: AttachmentScanner = resolveAttachmentScanner(),
): Promise<ScanOutcome> {
  let verdict: ScanVerdict

  if (!scanner.inspects) {
    verdict = { status: 'clean' }
  } else {
    try {
      const stored = await driver.read(attachment.partitionCode, attachment.storagePath)
      verdict = await scanner.scan({
        buffer: stored.buffer,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.fileSize,
      })
    } catch (error) {
      verdict = {
        status: 'failed',
        reason: error instanceof Error ? error.message : 'could not read the stored file',
      }
    }
  }

  const status = statusFor(verdict)
  const scannedAt = new Date()

  // Re-read under the EntityManager doing the writing, rather than mutating the
  // object handed in. Callers create the row inside `em.transactional(...)`, so
  // the instance they hold is managed by that transaction's fork and not by
  // this one — assigning to it and flushing here updated nothing at all, and
  // the upload answered `ready` for a row that was still `pending`.
  const managed = (await em.findOne(Attachment, { id: attachment.id })) ?? attachment
  managed.scanStatus = status
  managed.scannedAt = scannedAt
  managed.scanner = scanner.key
  await em.persist(managed).flush()

  // The caller's copy is what the response is built from, so it has to agree
  // with what was just written.
  attachment.scanStatus = status
  attachment.scannedAt = scannedAt
  attachment.scanner = scanner.key

  if (verdict.status === 'infected') {
    // Worth a warning on its own: this is the case an operator wants to see,
    // and the signature belongs in the log rather than in anything the uploader
    // is shown.
    logger.warn('Attachment rejected by malware scan', {
      attachmentId: attachment.id,
      tenantId: attachment.tenantId ?? null,
      organizationId: attachment.organizationId ?? null,
      scanner: scanner.key,
      signature: verdict.signature,
    })
  } else if (verdict.status === 'failed') {
    logger.error('Attachment scan could not complete', {
      attachmentId: attachment.id,
      scanner: scanner.key,
      reason: verdict.reason,
    })
  }

  return {
    status,
    scanner: scanner.key,
    signature: verdict.status === 'infected' ? verdict.signature : null,
  }
}

/**
 * Clear or queue a freshly uploaded attachment.
 *
 * A scanner that inspects nothing settles inline: there is no work to defer,
 * and parking every upload behind a queue that will only ever answer `clean`
 * would make a deployment without a scanner slower and less reliable than it
 * was before scanning existed.
 *
 * A scanner that does inspect runs off the request. The bytes are already in
 * storage and the row already exists in `pending`, so nothing is lost by
 * answering the upload before the verdict arrives — and the file stays
 * unreadable until it does.
 */
export async function requestAttachmentScan(
  em: EntityManager,
  attachment: Attachment,
  driver: StorageDriver,
  scanner: AttachmentScanner = resolveAttachmentScanner(),
): Promise<void> {
  if (!scanner.inspects) {
    await scanAttachment(em, attachment, driver, scanner)
    return
  }

  if (typeof (em as { fork?: unknown })?.fork !== 'function') {
    throw new Error(
      '[internal] attachment scanning requires an EntityManager that exposes fork(); reusing the ' +
        'request-scoped EntityManager after the response would race with later request mutations.',
    )
  }

  const workerEm = em.fork()
  const attachmentId = attachment.id

  setImmediate(() => {
    void (async () => {
      const fresh = await workerEm.findOne(Attachment, { id: attachmentId })
      if (!fresh) return
      await scanAttachment(workerEm, fresh, driver, scanner)
    })().catch((error) => {
      logger.error('Background scan error', { attachmentId, err: error })
    })
  })
}
