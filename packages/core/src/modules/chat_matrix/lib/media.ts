import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import type { ChatScope } from '@open-mercato/core/modules/chat/lib/scope'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('chat_matrix').child({ component: 'media' })

/**
 * What the storage layer gives us, narrowed to the two calls this needs.
 *
 * Typed structurally rather than by importing the driver classes: the factory
 * is reached through the container precisely so that this module does not take
 * a build-time dependency on the storage implementation.
 */
type StorageDriverLike = {
  read(partitionCode: string, storagePath: string): Promise<{ buffer: Buffer; contentType?: string }>
  store(payload: Record<string, unknown>): Promise<unknown>
}
type StorageDriverFactoryLike = {
  resolveForPartition(
    partitionCode: string,
    scope?: { tenantId?: string | null; organizationId?: string | null },
  ): Promise<StorageDriverLike>
}

export type ChatAttachmentBytes = {
  id: string
  fileName: string
  mimeType: string
  size: number
  buffer: Buffer
}

/**
 * The Matrix message type a file is rendered as.
 *
 * Matrix has no generic "attachment": a client decides how to render from the
 * `msgtype`, so a photo sent as `m.file` shows as a download link rather than a
 * picture. `m.file` is the honest fallback for everything else.
 */
export function matrixMsgtypeFor(mimeType: string | null | undefined): string {
  if (!mimeType) return 'm.file'
  if (mimeType.startsWith('image/')) return 'm.image'
  if (mimeType.startsWith('video/')) return 'm.video'
  if (mimeType.startsWith('audio/')) return 'm.audio'
  return 'm.file'
}

/**
 * Load the bytes of the attachments a message carries, ready to copy outward.
 *
 * **Only `clean` files leave Operis.** `attachments/lib/access.ts` gates serving
 * on exactly that status, so copying an `infected` or `failed` file into a room
 * would put bytes somewhere Operis itself refuses to serve them from — and the
 * room has no scan gate to catch it later. The scan runs inline during upload,
 * so the status is already terminal by the time a send reaches here; a
 * `pending` row means the scanner is still working and the file is skipped
 * rather than gambled on.
 *
 * A file that cannot be read is skipped, not raised: the message itself is what
 * the send is about, and losing it because one attachment's storage hiccuped
 * would be a far worse trade than a room that is missing a picture.
 */
export async function loadAttachmentBytes(input: {
  em: EntityManager
  container: AwilixContainer | undefined
  scope: ChatScope
  attachmentIds: readonly string[]
  maxBytes: number
}): Promise<ChatAttachmentBytes[]> {
  if (input.attachmentIds.length === 0) return []
  if (!input.container) {
    logger.debug('skipping attachment mirror: no container on the transport context')
    return []
  }

  let factory: StorageDriverFactoryLike
  try {
    factory = input.container.resolve<StorageDriverFactoryLike>('storageDriverFactory')
  } catch {
    logger.debug('skipping attachment mirror: no storage driver factory is registered')
    return []
  }

  const rows = await input.em.find(Attachment, {
    id: { $in: [...input.attachmentIds] },
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
  })

  const loaded: ChatAttachmentBytes[] = []
  for (const row of rows) {
    if (row.scanStatus !== 'clean') {
      logger.info('not copying an attachment the scan has not cleared', {
        attachmentId: row.id,
        scanStatus: row.scanStatus,
      })
      continue
    }
    if (row.fileSize > input.maxBytes) {
      logger.warn('not copying an attachment larger than the chat limit', {
        attachmentId: row.id,
        fileSize: row.fileSize,
        maxBytes: input.maxBytes,
      })
      continue
    }
    try {
      const driver = await factory.resolveForPartition(row.partitionCode, {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
      })
      const stored = await driver.read(row.partitionCode, row.storagePath)
      loaded.push({
        id: row.id,
        fileName: row.fileName,
        mimeType: stored.contentType ?? row.mimeType,
        size: row.fileSize,
        buffer: stored.buffer,
      })
    } catch (error) {
      logger.error('could not read an attachment to copy it into the room', {
        attachmentId: row.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // `em.find` does not promise the caller's order, and the transcript shows
  // attachments in the order they were staged.
  const position = new Map(input.attachmentIds.map((id, index) => [id, index]))
  return loaded.sort((left, right) => (position.get(left.id) ?? 0) - (position.get(right.id) ?? 0))
}

/**
 * Bring a file posted in a Matrix client into Operis' own attachment store.
 *
 * **The bytes are copied, never linked.** Serving a bridged file straight from
 * Synapse would put it outside `scan_status` — the one thing chat's attachment
 * design refuses to allow — so it goes through the same upload service the HTTP
 * route uses, gets scanned by the same scanner, and is served by the same
 * authorized route as anything a colleague uploaded.
 *
 * It lands as a DRAFT owned by the sender, because that is the only shape
 * `chat.messages.send` can link: the projector is not allowed to write the link
 * itself, and routing through the command is what keeps mention validation, the
 * search document and the conversation preview applied by the code that owns
 * them.
 *
 * Returns `null` when the file cannot be brought across, and the caller then
 * projects the event as an ordinary message. That is a deliberate degradation:
 * a message reading `holiday.png` is worse than the picture and far better than
 * a transcript with a hole in it.
 */
export async function ingestMatrixMedia(input: {
  em: EntityManager
  container: AwilixContainer | undefined
  scope: ChatScope
  conversationId: string
  senderUserId: string
  fileName: string
  mimeType: string | null
  buffer: Buffer
  maxBytes: number
}): Promise<string | null> {
  if (!input.container) {
    logger.debug('cannot ingest matrix media: no container on the projection context')
    return null
  }
  if (input.buffer.length > input.maxBytes) {
    logger.warn('refusing to ingest a matrix file larger than the chat limit', {
      size: input.buffer.length,
      maxBytes: input.maxBytes,
    })
    return null
  }

  const { CHAT_ATTACHMENT_PARTITION } = await import(
    '@open-mercato/core/modules/chat/lib/attachmentPolicy'
  )
  const { CHAT_DRAFT_ATTACHMENT_ENTITY_ID, buildChatAttachmentMetadata } = await import(
    '@open-mercato/core/modules/chat/lib/attachments'
  )

  type UploadServiceLike = {
    upload(payload: Record<string, unknown>): Promise<{ id: string; scanStatus: string }>
  }

  let service: UploadServiceLike
  try {
    service = input.container.resolve<UploadServiceLike>('attachmentScopedUploadService')
  } catch {
    logger.debug('cannot ingest matrix media: no attachment upload service is registered')
    return null
  }

  let attachmentId: string
  let initialStatus = 'pending'
  try {
    const created = await service.upload({
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      entityId: CHAT_DRAFT_ATTACHMENT_ENTITY_ID,
      // The conversation, exactly as the HTTP upload route stages it. The send
      // command replaces this with the message id when it links the draft.
      recordId: input.conversationId,
      fileName: input.fileName,
      declaredMimeType: input.mimeType,
      buffer: input.buffer,
      partitionCode: CHAT_ATTACHMENT_PARTITION,
      maxBytes: input.maxBytes,
      // The sender owns the draft, because `linkDraftAttachmentsToMessage`
      // refuses a draft whose uploader is not the person sending.
      metadata: buildChatAttachmentMetadata({
        uploaderUserId: input.senderUserId,
        conversationId: input.conversationId,
      }),
    })
    attachmentId = created.id
    initialStatus = created.scanStatus
  } catch (error) {
    logger.error('could not store a file that arrived over Matrix', {
      fileName: input.fileName,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }

  /**
   * Only re-read when the verdict is genuinely outstanding.
   *
   * `scanAttachment` mirrors the status onto the object the upload service
   * returns, so with no scanner configured — the default — it is already
   * `clean` and a second query would answer the same thing more slowly.
   */
  const cleared =
    initialStatus === 'pending' ? await waitForTerminalScan(input.em, attachmentId) : initialStatus
  if (cleared !== 'clean') {
    logger.warn('a file that arrived over Matrix did not pass the scan', {
      attachmentId,
      scanStatus: cleared,
    })
    return null
  }
  return attachmentId
}

/**
 * Wait for the scanner's verdict, briefly.
 *
 * With no scanner configured the upload service settles the row to `clean`
 * inline and the first read answers. With a real one the verdict lands on a
 * `setImmediate` in this same process, so the row is `pending` for a moment and
 * the send that follows would be refused with `not_ready`. Polling a fresh read
 * is what closes that window without making the projector care which scanner is
 * deployed.
 *
 * Bounded, because the sync loop must keep moving: an unresolved verdict is
 * reported as itself and the caller degrades to a text message.
 */
async function waitForTerminalScan(
  em: EntityManager,
  attachmentId: string,
  attempts = 20,
  delayMs = 250,
): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const fresh = await em.fork().findOne(Attachment, { id: attachmentId })
    const status = fresh?.scanStatus ?? 'failed'
    if (status !== 'pending') return status
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  return 'pending'
}
