import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { ChatMessage, ChatMessageReaction, ChatPinnedMessage } from '../data/entities'
import type { ChatReactionDto } from '../data/types'
import { extractMentionedUserIds } from './mentions'
import { loadOrganizationMembers, type ChatScope } from './scope'
import { getAttachmentsForMessages } from './attachments'
import { toChatAttachmentDto } from './attachmentDto'
import type { ChatAttachmentDto } from '../data/types'

/**
 * How many reactor names travel with a reaction.
 *
 * The tooltip shows a few and then "and N others". Sending every name would make
 * a message with fifty thumbs-up the heaviest thing in the transcript, and would
 * put the full reactor list of a large space into a payload nobody reads.
 */
export const REACTION_SAMPLE_LIMIT = 5

/**
 * Everything a page of messages needs beyond the message rows themselves:
 * reactions, mention names, and which of them are pinned.
 *
 * Three queries for the whole page, not three per message. Each is a single
 * grouped or batched read keyed on the page's ids, so a transcript of thirty
 * messages costs the same as one of three.
 */
export type MessageExtras = {
  reactionsByMessage: Map<string, ChatReactionDto[]>
  namesByUserId: Map<string, string>
  pinnedMessageIds: Set<string>
  /** Files per message, loaded for the whole page in one read. */
  attachmentsByMessage: Map<string, ChatAttachmentDto[]>
}

export async function loadMessageExtras(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
  messages: readonly ChatMessage[],
  viewerUserId: string,
  fallbackName: string,
): Promise<MessageExtras> {
  const empty: MessageExtras = {
    reactionsByMessage: new Map(),
    namesByUserId: new Map(),
    pinnedMessageIds: new Set(),
    attachmentsByMessage: new Map(),
  }
  if (messages.length === 0) return empty

  const messageIds = messages.map((message) => message.id)

  const [reactionRows, pinnedRows] = await Promise.all([
    em.find(
      ChatMessageReaction,
      {
        messageId: { $in: messageIds },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    ),
    em.find(ChatPinnedMessage, {
      conversationId,
      messageId: { $in: messageIds },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }),
  ])

  // Every person the page names, plus everyone who reacted to it — resolved in
  // one lookup rather than one per mention and one per reaction.
  const wanted = new Set<string>()
  for (const message of messages) for (const id of extractMentionedUserIds(message.body)) wanted.add(id)
  for (const reaction of reactionRows) wanted.add(reaction.userId)

  const people = await loadOrganizationMembers(em, scope, [...wanted])
  const namesByUserId = new Map([...people].map(([id, person]) => [id, person.name]))

  /**
   * Aggregate into `emoji → count`, preserving first-reaction order so the chips
   * do not reshuffle as counts change. Grouping here rather than in SQL keeps it
   * one query and one pass; the row count is bounded by the page.
   */
  const reactionsByMessage = new Map<string, ChatReactionDto[]>()
  for (const reaction of reactionRows) {
    const list = reactionsByMessage.get(reaction.messageId) ?? []
    let entry = list.find((candidate) => candidate.emoji === reaction.emoji)
    if (!entry) {
      entry = { emoji: reaction.emoji, count: 0, mine: false, sampleNames: [] }
      list.push(entry)
    }
    entry.count += 1
    if (reaction.userId === viewerUserId) entry.mine = true
    if (entry.sampleNames.length < REACTION_SAMPLE_LIMIT) {
      entry.sampleNames.push(namesByUserId.get(reaction.userId) ?? fallbackName)
    }
    reactionsByMessage.set(reaction.messageId, list)
  }

  // One read for the page's files, alongside the page's reactions and pins.
  // A transcript renders many messages, and a per-message lookup here is the
  // query pattern that makes a busy conversation slow in the place people
  // notice most.
  const attachmentRows = await getAttachmentsForMessages({ em, scope, messageIds })
  const attachmentsByMessage = new Map<string, ChatAttachmentDto[]>()
  for (const [messageId, rows] of attachmentRows) {
    attachmentsByMessage.set(messageId, rows.map(toChatAttachmentDto))
  }

  return {
    reactionsByMessage,
    namesByUserId,
    pinnedMessageIds: new Set(pinnedRows.map((pin) => pin.messageId)),
    attachmentsByMessage,
  }
}

/** The mention names for one message, narrowed from the page-wide lookup. */
export function mentionNamesFor(
  message: ChatMessage,
  namesByUserId: ReadonlyMap<string, string>,
  fallbackName: string,
): Record<string, string> {
  const names: Record<string, string> = {}
  for (const id of extractMentionedUserIds(message.body)) {
    names[id] = namesByUserId.get(id) ?? fallbackName
  }
  return names
}

/**
 * Whether each conversation holds an unread message that names the viewer.
 *
 * One grouped query for the whole conversation list. The alternative — asking
 * per conversation — is the N+1 that the unread count itself was written to
 * avoid, and this reads the same cursor.
 *
 * `@everyone` counts, but only in the conversation it was sent to and only for
 * people who are members now: the predicate joins the viewer's own participant
 * row, so a message addressed to a space the viewer has left matches nothing.
 */
export async function loadUnreadMentionFlags(
  em: EntityManager,
  scope: ChatScope,
  viewerUserId: string,
  conversationIds: readonly string[],
): Promise<Set<string>> {
  const flagged = new Set<string>()
  if (conversationIds.length === 0) return flagged

  const rows = await sql<{ conversation_id: string }>`
    select distinct m.conversation_id
      from chat_messages m
      join chat_participants p
        on p.conversation_id = m.conversation_id
       and p.user_id = ${viewerUserId}::uuid
       and p.tenant_id = ${scope.tenantId}::uuid
       and p.organization_id = ${scope.organizationId}::uuid
     where m.conversation_id = any(${[...conversationIds]}::uuid[])
       and m.deleted_at is null
       and m.kind = 'user'
       and m.sender_user_id <> ${viewerUserId}::uuid
       and m.created_at > coalesce(p.last_read_at, '-infinity'::timestamptz)
       -- Only what was said once you were in the room.
       --
       -- everyone-mentions are stored as a flag and resolved against live
       -- membership, which is what keeps a departed member from being
       -- notified. Without this line it does the opposite too: someone added
       -- to a space today inherits a null read cursor, so every such message
       -- ever sent there becomes an unread mention addressed to them
       -- personally. They were not named - they were not there.
       and m.created_at >= p.created_at
       and (
         m.mentions_everyone
         or exists (
           select 1 from chat_message_mentions mm
            where mm.message_id = m.id
              and mm.mentioned_user_id = ${viewerUserId}::uuid
         )
       )
  `.execute(em.getKysely())

  for (const row of rows.rows) flagged.add(String(row.conversation_id))
  return flagged
}
