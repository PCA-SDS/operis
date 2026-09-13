import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import type { ChatScope } from './scope'

/**
 * Files attached to chat messages.
 *
 * There is no chat-owned attachment table. `attachments` already links to any
 * record through `(entity_id, record_id)`, which is how the messages module
 * carries its own files, so a second table here would be a parallel copy of
 * something that already works — and a second place for tenant scoping to be
 * got wrong.
 *
 * What chat does own is the authorization: an attachment is readable because
 * the reader is in the conversation its message belongs to. The attachments
 * module cannot know that, which is why it asks callers for the targets they
 * have already authorized rather than trying to decide for them.
 */

/** Where an attachment lives once its message exists. */
export const CHAT_MESSAGE_ATTACHMENT_ENTITY_ID = 'chat:chat_message'

/**
 * Where an attachment lives before its message exists.
 *
 * A file is uploaded while the message is still being written, so it needs a
 * home for the interval between "uploaded" and "sent" — and that home must not
 * be the message entity, or a draft would be indistinguishable from a real
 * attachment on a message that was never created.
 */
export const CHAT_DRAFT_ATTACHMENT_ENTITY_ID = 'chat:chat_message_draft'

/**
 * What chat records about an upload of its own.
 *
 * Kept in `storage_metadata` rather than in new columns because it is chat's
 * business, not the attachment table's: the uploader and the conversation are
 * what decide who may see a draft, and no other module has that question.
 */
export type ChatAttachmentMetadata = {
  uploaderUserId: string
  conversationId: string
}

const METADATA_KEY = 'chat'

export function buildChatAttachmentMetadata(
  meta: ChatAttachmentMetadata,
): Record<string, unknown> {
  return { [METADATA_KEY]: meta }
}

export function readChatAttachmentMetadata(
  storageMetadata: Record<string, unknown> | null | undefined,
): ChatAttachmentMetadata | null {
  const raw = storageMetadata?.[METADATA_KEY]
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<ChatAttachmentMetadata>
  if (typeof value.uploaderUserId !== 'string' || typeof value.conversationId !== 'string') {
    return null
  }
  return { uploaderUserId: value.uploaderUserId, conversationId: value.conversationId }
}

export class ChatAttachmentError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'not_ready' | 'rejected',
  ) {
    super(message)
    this.name = 'ChatAttachmentError'
  }
}

/**
 * Move a set of drafts onto the message that was just sent.
 *
 * Every check here is a way the association could be forged, and each is
 * answered from the server's own copy rather than from anything the client
 * said (§103): the rows are re-read under the caller's tenant and organization,
 * they must still be drafts, they must belong to *this* uploader, and they must
 * have been uploaded against *this* conversation. A client that sends someone
 * else's attachment id, or one from a conversation it can see but this message
 * is not in, gets nothing.
 *
 * Runs inside the send transaction, so a message and its files commit together
 * or not at all — there is no window where a message exists with its
 * attachments still parked as drafts.
 */
export async function linkDraftAttachmentsToMessage(input: {
  em: EntityManager
  scope: ChatScope
  uploaderUserId: string
  conversationId: string
  messageId: string
  attachmentIds: string[]
}): Promise<Attachment[]> {
  const { em, scope, uploaderUserId, conversationId, messageId, attachmentIds } = input
  if (attachmentIds.length === 0) return []

  const drafts = await em.find(Attachment, {
    id: { $in: attachmentIds },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    entityId: CHAT_DRAFT_ATTACHMENT_ENTITY_ID,
  })

  const byId = new Map(drafts.map((draft) => [draft.id, draft]))
  const linked: Attachment[] = []

  for (const attachmentId of attachmentIds) {
    const draft = byId.get(attachmentId)
    if (!draft) {
      throw new ChatAttachmentError('[internal] chat attachment is not an available draft', 'not_found')
    }

    const meta = readChatAttachmentMetadata(draft.storageMetadata)
    if (!meta || meta.uploaderUserId !== uploaderUserId || meta.conversationId !== conversationId) {
      // Same answer as a missing row on purpose: someone probing ids should not
      // be able to tell "that is not yours" from "that does not exist".
      throw new ChatAttachmentError('[internal] chat attachment is not an available draft', 'not_found')
    }

    // A file that has not cleared its scan never reaches a message. Sending it
    // would put an entry in front of every participant that none of them can
    // open, which is worse than refusing the send.
    if (draft.scanStatus === 'infected') {
      throw new ChatAttachmentError('[internal] chat attachment was rejected by the scan', 'rejected')
    }
    if (draft.scanStatus !== 'clean') {
      throw new ChatAttachmentError('[internal] chat attachment has not finished scanning', 'not_ready')
    }

    draft.entityId = CHAT_MESSAGE_ATTACHMENT_ENTITY_ID
    draft.recordId = messageId
    linked.push(draft)
  }

  return linked
}

/**
 * The attachments on a set of messages, in one read.
 *
 * Batched by design: a transcript page renders many messages, and asking per
 * message is the query pattern that makes a conversation slow in exactly the
 * places people notice.
 *
 * Scope is part of the query rather than checked afterwards, for the same
 * reason it is everywhere else in chat — a row from another tenant is never a
 * candidate, so it cannot leak through a count or an off-by-one.
 */
export async function getAttachmentsForMessages(input: {
  em: EntityManager
  scope: ChatScope
  messageIds: string[]
}): Promise<Map<string, Attachment[]>> {
  const { em, scope, messageIds } = input
  const byMessage = new Map<string, Attachment[]>()
  if (messageIds.length === 0) return byMessage

  const rows = await em.find(
    Attachment,
    {
      entityId: CHAT_MESSAGE_ATTACHMENT_ENTITY_ID,
      recordId: { $in: messageIds },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    { orderBy: { createdAt: 'asc' } },
  )

  for (const row of rows) {
    const existing = byMessage.get(row.recordId)
    if (existing) existing.push(row)
    else byMessage.set(row.recordId, [row])
  }
  return byMessage
}

/**
 * Drafts this person has parked against this conversation.
 *
 * Scoped to the uploader, not to the conversation: a draft is not shared, and
 * showing one participant another's half-composed upload would be a disclosure
 * nobody asked for.
 */
export async function getDraftAttachments(input: {
  em: EntityManager
  scope: ChatScope
  uploaderUserId: string
  conversationId: string
}): Promise<Attachment[]> {
  const { em, scope, uploaderUserId, conversationId } = input
  const drafts = await em.find(
    Attachment,
    {
      entityId: CHAT_DRAFT_ATTACHMENT_ENTITY_ID,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    { orderBy: { createdAt: 'asc' } },
  )

  return drafts.filter((draft) => {
    const meta = readChatAttachmentMetadata(draft.storageMetadata)
    return meta?.uploaderUserId === uploaderUserId && meta.conversationId === conversationId
  })
}
