import { createHash, randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  Attachment,
  AttachmentPartition,
  AttachmentQuotaReservation,
} from '@open-mercato/core/modules/attachments/data/entities'
import type { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers'
import { assertAttachmentScopeInvariant } from '@open-mercato/core/modules/attachments/lib/access'
import { ensureDefaultPartitions } from '@open-mercato/core/modules/attachments/lib/partitions'
import { buildAttachmentFileUrl } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import {
  detectAttachmentMimeType,
  hasDangerousExecutableExtension,
  isActiveContentAttachment,
  sanitizeUploadedFileName,
} from '@open-mercato/core/modules/attachments/lib/security'
import { requestAttachmentScan } from '@open-mercato/core/modules/attachments/lib/scanning/scanService'
import { inspectArchive, isArchiveFileName } from '@open-mercato/core/modules/attachments/lib/archiveInspection'
import type { AttachmentQuotaService } from '@open-mercato/core/modules/attachments/lib/quota-service'
import { badRequest, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { ChatScope } from './scope'
import { CHAT_ATTACHMENT_PARTITION, resolveChatAttachmentLimits } from './attachmentPolicy'
import { CHAT_DRAFT_ATTACHMENT_ENTITY_ID, buildChatAttachmentMetadata } from './attachments'

const logger = createLogger('chat').child({ component: 'direct-upload' })

/**
 * Uploading straight to storage.
 *
 * The bytes never pass through the app, which is the only way a 200 MB limit is
 * honest: streaming that through a Node request means holding it, and holding
 * it means a handful of concurrent uploads can take the process down.
 *
 * What the app keeps is the two ends. It decides whether the upload may happen
 * at all and mints a key the client cannot choose, and afterwards it reads back
 * what actually landed. In between it trusts nothing: a client that could name
 * its own key could write outside its tenant, and a client whose word was taken
 * about size or type could walk around both the quota and the file policy.
 */


/** The partition chat uploads into, resolved the way every other caller does. */
async function chatPartition(em: EntityManager, scope: ChatScope, code?: string | null) {
  await ensureDefaultPartitions(em)
  return em.findOne(AttachmentPartition, {
    code: code ?? CHAT_ATTACHMENT_PARTITION,
    $or: [
      { tenantId: null, organizationId: null },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    ],
  })
}

export type ChatDirectUploadTicket =
  | {
      supported: true
      uploadId: string
      url: string
      method: 'PUT'
      headers: Record<string, string>
      expiresAt: string
    }
  | { supported: false }

/** Ties a reservation to the person and conversation it was issued for. */
function uploadTokenFor(input: {
  uploaderUserId: string
  conversationId: string
  storagePath: string
}): string {
  return createHash('sha256')
    .update(`${input.uploaderUserId}|${input.conversationId}|${input.storagePath}`)
    .digest('hex')
}

/**
 * Decide whether a direct upload may happen, and issue the ticket.
 *
 * The quota is reserved *before* the ticket exists, not after the upload lands.
 * Reserving afterwards would mean the bytes are already stored when the tenant
 * turns out to be over its limit, which is a bill nobody agreed to and a file
 * that has to be deleted again.
 */
export async function resolveChatDirectUpload(input: {
  em: EntityManager
  scope: ChatScope
  uploaderUserId: string
  conversationId: string
  storageDriverFactory: StorageDriverFactory
  quotaService: AttachmentQuotaService
  fileName: string
  contentType: string
  contentLength: number
}): Promise<ChatDirectUploadTicket> {
  const safeName = sanitizeUploadedFileName(input.fileName)
  const limits = resolveChatAttachmentLimits()

  // Refused before a ticket exists, not after the bytes arrive. The policy is
  // the same one the multipart path applies; only the transport differs.
  if (hasDangerousExecutableExtension(safeName)) throw badRequest('dangerous_executable')
  if (input.contentLength > limits.maxBytes) throw badRequest('max_upload_size')
  // Archives cannot be inspected before they exist, so they keep to the path
  // where the server sees the bytes. Refusing here is not a limitation of
  // direct upload so much as an admission that inspection needs the file.
  if (isArchiveFileName(safeName)) return { supported: false }

  const partition = await chatPartition(input.em, input.scope)
  if (!partition) throw badRequest('partition_unavailable')

  const driver = await input.storageDriverFactory.resolveForPartition(partition.code, {
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
  })
  // The capability the store either has or does not. Development runs on the
  // local driver, and the client falling back to multipart is what keeps it
  // behaving as production does rather than breaking differently.
  if (typeof driver.createDirectUpload !== 'function') return { supported: false }

  const ticket = await driver.createDirectUpload({
    partitionCode: partition.code,
    orgId: input.scope.organizationId,
    tenantId: input.scope.tenantId,
    fileName: safeName,
    contentType: input.contentType,
    contentLength: input.contentLength,
  })

  const reservation = await input.quotaService.reserve({
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
    bytes: input.contentLength,
    source: 'attachment',
    storageDriver: partition.storageDriver || 'local',
    storagePath: ticket.storagePath,
    partitionCode: partition.code,
    // Binds the reservation to this person and this conversation, so a
    // finalisation cannot claim somebody else's in-flight upload.
    uploadTokenHash: uploadTokenFor({
      uploaderUserId: input.uploaderUserId,
      conversationId: input.conversationId,
      storagePath: ticket.storagePath,
    }),
  })

  return {
    supported: true,
    uploadId: reservation.id,
    url: ticket.url,
    method: 'PUT',
    headers: ticket.headers,
    expiresAt: ticket.expiresAt,
  }
}

/**
 * Turn a completed upload into an attachment, verifying everything first.
 *
 * This is the whole reason a direct upload is safe: the server has seen none of
 * the bytes, so every fact it records is read back from storage, and every
 * claim the client could have made is checked against something it does not
 * control.
 */
export async function finalizeChatDirectUpload(input: {
  em: EntityManager
  scope: ChatScope
  uploaderUserId: string
  conversationId: string
  uploadId: string
  storageDriverFactory: StorageDriverFactory
  quotaService: AttachmentQuotaService
  dataEngine?: DataEngine | null
}): Promise<Attachment> {
  const { em, scope } = input

  const reservation = await em.findOne(AttachmentQuotaReservation, {
    id: input.uploadId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  // Same answer for "never existed" and "not yours": a caller probing ids
  // should not be able to tell them apart.
  if (!reservation) throw notFound('upload_not_found')

  // The reservation was minted for one person, in one conversation, at one key.
  const expectedToken = uploadTokenFor({
    uploaderUserId: input.uploaderUserId,
    conversationId: input.conversationId,
    storagePath: reservation.storagePath,
  })
  if (reservation.uploadTokenHash !== expectedToken) throw notFound('upload_not_found')

  const partition = await chatPartition(em, scope, reservation.partitionCode)
  if (!partition) throw badRequest('partition_unavailable')
  const driver = await input.storageDriverFactory.resolveForPartition(partition.code, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  // What is actually there, if anything. A client that never uploaded, or gave
  // up halfway, reaches this point looking exactly like one that succeeded.
  const facts = typeof driver.stat === 'function'
    ? await driver.stat(partition.code, reservation.storagePath)
    : null
  if (!facts) {
    await input.quotaService.release(reservation.id, reservation.leaseToken)
    throw badRequest('upload_missing')
  }

  const limits = resolveChatAttachmentLimits()
  if (facts.size > limits.maxBytes || facts.size > Number(reservation.reservedBytes)) {
    // Larger than what was reserved: the ticket's content-length is signed, so
    // this should be unreachable — which is exactly why it is worth checking.
    await discard(driver, partition.code, reservation, input.quotaService)
    throw badRequest('max_upload_size')
  }

  // Read from the object, never from the request. The bytes are needed for the
  // sniff anyway, and the scan will read them again.
  const stored = await driver.read(partition.code, reservation.storagePath)
  const fileName = sanitizeUploadedFileName(reservation.storagePath.split('/').pop() ?? 'file')
  const mimeType = detectAttachmentMimeType(stored.buffer, fileName, facts.contentType ?? null)

  if (hasDangerousExecutableExtension(fileName) || isActiveContentAttachment(stored.buffer, fileName, mimeType)) {
    await discard(driver, partition.code, reservation, input.quotaService)
    throw badRequest('dangerous_executable')
  }
  if (isArchiveFileName(fileName)) {
    const inspection = inspectArchive(fileName, stored.buffer)
    if (!inspection.ok) {
      await discard(driver, partition.code, reservation, input.quotaService)
      throw badRequest('archive_rejected')
    }
  }

  const attachmentId = randomUUID()
  const attachment = em.create(Attachment, {
    id: attachmentId,
    entityId: CHAT_DRAFT_ATTACHMENT_ENTITY_ID,
    recordId: input.conversationId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    fileName,
    mimeType,
    fileSize: facts.size,
    partitionCode: partition.code,
    storageDriver: partition.storageDriver || 'local',
    storagePath: reservation.storagePath,
    url: buildAttachmentFileUrl(attachmentId),
    storageMetadata: buildChatAttachmentMetadata({
      uploaderUserId: input.uploaderUserId,
      conversationId: input.conversationId,
    }),
  })
  assertAttachmentScopeInvariant({
    tenantId: attachment.tenantId,
    organizationId: attachment.organizationId,
  })

  await em.transactional(async (tx) => {
    tx.persist(attachment)
    await tx.flush()
    await input.quotaService.completeAttachment(reservation.id, reservation.leaseToken, tx)
  })

  // The row is `pending` until this settles, so nothing can read it meanwhile.
  try {
    await requestAttachmentScan(em, attachment, driver)
  } catch (error) {
    logger.error('Failed to start scan for a direct upload', { attachmentId, err: error })
  }

  return attachment
}

/** Remove a rejected object and give its reserved bytes back. */
async function discard(
  driver: Awaited<ReturnType<StorageDriverFactory['resolveForPartition']>>,
  partitionCode: string,
  reservation: AttachmentQuotaReservation,
  quotaService: AttachmentQuotaService,
): Promise<void> {
  try {
    await (driver.deleteStrict?.(partitionCode, reservation.storagePath)
      ?? driver.delete(partitionCode, reservation.storagePath))
  } catch (error) {
    // The reservation is still released below; a leftover object is the
    // recovery worker's problem, not a reason to keep the quota held.
    logger.error('Could not remove a rejected direct upload', { err: error })
  }
  await quotaService.release(reservation.id, reservation.leaseToken)
}
