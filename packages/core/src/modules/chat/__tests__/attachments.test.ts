/**
 * Attaching a file to a chat message.
 *
 * The link is the security boundary: an attachment is readable because it hangs
 * off a message in a conversation the reader belongs to, so forging the link is
 * the way to reach a file you were never sent. Each case below is one way to
 * try it.
 */
import {
  CHAT_DRAFT_ATTACHMENT_ENTITY_ID,
  CHAT_MESSAGE_ATTACHMENT_ENTITY_ID,
  ChatAttachmentError,
  buildChatAttachmentMetadata,
  getAttachmentsForMessages,
  getDraftAttachments,
  linkDraftAttachmentsToMessage,
  readChatAttachmentMetadata,
} from '../lib/attachments'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const UPLOADER = 'user-1'
const CONVERSATION = 'conversation-1'
const MESSAGE = 'message-1'

type Row = {
  id: string
  entityId: string
  recordId: string
  tenantId: string
  organizationId: string
  scanStatus: string
  storageMetadata: Record<string, unknown> | null
  createdAt: Date
}

function draft(overrides: Partial<Row> = {}): Row {
  return {
    id: 'attachment-1',
    entityId: CHAT_DRAFT_ATTACHMENT_ENTITY_ID,
    recordId: 'draft-1',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    scanStatus: 'clean',
    storageMetadata: buildChatAttachmentMetadata({
      uploaderUserId: UPLOADER,
      conversationId: CONVERSATION,
    }),
    createdAt: new Date('2026-09-10T00:00:00.000Z'),
    ...overrides,
  }
}

/** An `em` that returns the rows a real query would, filtered the same way. */
function entityManager(rows: Row[]) {
  return {
    find: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      return rows.filter((row) => {
        if (where.tenantId && row.tenantId !== where.tenantId) return false
        if (where.organizationId && row.organizationId !== where.organizationId) return false
        if (where.entityId && row.entityId !== where.entityId) return false
        const id = where.id as { $in?: string[] } | undefined
        if (id?.$in && !id.$in.includes(row.id)) return false
        const recordId = where.recordId as { $in?: string[] } | undefined
        if (recordId?.$in && !recordId.$in.includes(row.recordId)) return false
        return true
      })
    }),
  } as never
}

const link = (rows: Row[], attachmentIds: string[], overrides: Record<string, string> = {}) =>
  linkDraftAttachmentsToMessage({
    em: entityManager(rows),
    scope,
    uploaderUserId: UPLOADER,
    conversationId: CONVERSATION,
    messageId: MESSAGE,
    attachmentIds,
    ...overrides,
  })

describe('linking drafts to a message', () => {
  it('moves the draft onto the message', async () => {
    const rows = [draft()]
    const linked = await link(rows, ['attachment-1'])
    expect(linked).toHaveLength(1)
    expect(rows[0]!.entityId).toBe(CHAT_MESSAGE_ATTACHMENT_ENTITY_ID)
    expect(rows[0]!.recordId).toBe(MESSAGE)
  })

  it('does nothing when there is nothing to attach', async () => {
    await expect(link([], [])).resolves.toEqual([])
  })

  it('refuses an attachment uploaded by somebody else', async () => {
    const rows = [
      draft({
        storageMetadata: buildChatAttachmentMetadata({
          uploaderUserId: 'someone-else',
          conversationId: CONVERSATION,
        }),
      }),
    ]
    await expect(link(rows, ['attachment-1'])).rejects.toBeInstanceOf(ChatAttachmentError)
    expect(rows[0]!.entityId).toBe(CHAT_DRAFT_ATTACHMENT_ENTITY_ID)
  })

  it('refuses a draft uploaded against a different conversation', async () => {
    // Otherwise a member of two conversations could carry a file from the one
    // they may read into the one they are sending to.
    const rows = [
      draft({
        storageMetadata: buildChatAttachmentMetadata({
          uploaderUserId: UPLOADER,
          conversationId: 'another-conversation',
        }),
      }),
    ]
    await expect(link(rows, ['attachment-1'])).rejects.toBeInstanceOf(ChatAttachmentError)
  })

  it('refuses an attachment from another tenant', async () => {
    const rows = [draft({ tenantId: 'tenant-2', organizationId: 'org-2' })]
    await expect(link(rows, ['attachment-1'])).rejects.toBeInstanceOf(ChatAttachmentError)
  })

  it('refuses a row that is already on a message', async () => {
    // Re-linking a sent attachment would move somebody else's file onto a new
    // message, which is how a file leaves the conversation it was sent to.
    const rows = [draft({ entityId: CHAT_MESSAGE_ATTACHMENT_ENTITY_ID, recordId: 'other-message' })]
    await expect(link(rows, ['attachment-1'])).rejects.toBeInstanceOf(ChatAttachmentError)
  })

  it('answers a forged id the same way as one that is not yours', async () => {
    // Probing ids must not distinguish "not yours" from "does not exist".
    const notMine = link([draft({ storageMetadata: buildChatAttachmentMetadata({ uploaderUserId: 'x', conversationId: CONVERSATION }) })], ['attachment-1'])
    const missing = link([], ['attachment-1'])
    await expect(notMine).rejects.toMatchObject({ code: 'not_found' })
    await expect(missing).rejects.toMatchObject({ code: 'not_found' })
  })

  it('will not attach a file the scan rejected', async () => {
    const rows = [draft({ scanStatus: 'infected' })]
    await expect(link(rows, ['attachment-1'])).rejects.toMatchObject({ code: 'rejected' })
  })

  it.each(['pending', 'failed'])('will not attach a file that is %s', async (scanStatus) => {
    // Sending it would put an entry in front of every participant that none of
    // them can open.
    const rows = [draft({ scanStatus })]
    await expect(link(rows, ['attachment-1'])).rejects.toMatchObject({ code: 'not_ready' })
  })

  it('attaches nothing at all when one of several is not allowed', async () => {
    const rows = [draft({ id: 'ok' }), draft({ id: 'bad', scanStatus: 'infected' })]
    await expect(link(rows, ['ok', 'bad'])).rejects.toBeInstanceOf(ChatAttachmentError)
    // The caller runs this inside the send transaction, so throwing is what
    // keeps a half-attached message from committing.
    expect(rows[1]!.entityId).toBe(CHAT_DRAFT_ATTACHMENT_ENTITY_ID)
  })
})

describe('reading attachments', () => {
  it('groups a page of messages in one query', async () => {
    const rows = [
      draft({ id: 'a', entityId: CHAT_MESSAGE_ATTACHMENT_ENTITY_ID, recordId: 'm1' }),
      draft({ id: 'b', entityId: CHAT_MESSAGE_ATTACHMENT_ENTITY_ID, recordId: 'm1' }),
      draft({ id: 'c', entityId: CHAT_MESSAGE_ATTACHMENT_ENTITY_ID, recordId: 'm2' }),
    ]
    const em = entityManager(rows)
    const grouped = await getAttachmentsForMessages({ em, scope, messageIds: ['m1', 'm2'] })
    expect(grouped.get('m1')).toHaveLength(2)
    expect(grouped.get('m2')).toHaveLength(1)
    // One read for the whole page, not one per message.
    expect((em as unknown as { find: jest.Mock }).find).toHaveBeenCalledTimes(1)
  })

  it('asks the database nothing for an empty page', async () => {
    const em = entityManager([])
    await getAttachmentsForMessages({ em, scope, messageIds: [] })
    expect((em as unknown as { find: jest.Mock }).find).not.toHaveBeenCalled()
  })

  it('shows a person only their own drafts', async () => {
    const rows = [
      draft({ id: 'mine' }),
      draft({
        id: 'theirs',
        storageMetadata: buildChatAttachmentMetadata({
          uploaderUserId: 'someone-else',
          conversationId: CONVERSATION,
        }),
      }),
    ]
    const drafts = await getDraftAttachments({
      em: entityManager(rows),
      scope,
      uploaderUserId: UPLOADER,
      conversationId: CONVERSATION,
    })
    expect(drafts.map((row) => row.id)).toEqual(['mine'])
  })
})

describe('chat attachment metadata', () => {
  it('round-trips', () => {
    const meta = { uploaderUserId: UPLOADER, conversationId: CONVERSATION }
    expect(readChatAttachmentMetadata(buildChatAttachmentMetadata(meta))).toEqual(meta)
  })

  it('reads malformed metadata as absent rather than trusting half of it', () => {
    expect(readChatAttachmentMetadata(null)).toBeNull()
    expect(readChatAttachmentMetadata({})).toBeNull()
    expect(readChatAttachmentMetadata({ chat: { uploaderUserId: UPLOADER } })).toBeNull()
    expect(readChatAttachmentMetadata({ chat: 'nonsense' })).toBeNull()
  })
})
