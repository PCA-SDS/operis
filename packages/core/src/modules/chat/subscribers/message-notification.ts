import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { ChatConversation, ChatMessage, ChatMessageMention, ChatParticipant } from '../data/entities'
import { notificationTypes } from '../notifications'

const logger = createLogger('chat').child({ component: 'message-notification' })

export const metadata = {
  event: 'chat.message.sent',
  persistent: true,
  id: 'chat:message-notification',
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve<T = unknown>(name: string): T }
  tenantId?: string | null
  organizationId?: string | null
}

const readString = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * Tell people about a message they would otherwise have to be looking to see.
 *
 * **Who gets told is the entire design.** A direct conversation notifies its one
 * counterpart. A space notifies only the people the message NAMES — a mention or
 * `@everyone` — and nobody else, because one row per member per message is the
 * noise the read-cursor unread model exists to avoid, and a busy space would
 * generate it thousands of times a day. The unread badge is what tells you a
 * space has been active; a notification is what tells you it wants you.
 *
 * Three exclusions on top, all for the same reason — a notification that was
 * never going to be useful is worse than none:
 *
 * - the sender, who knows what they just wrote;
 * - anyone who has muted the conversation;
 * - anyone whose read cursor is already past the message, which is the person
 *   who was reading the conversation as it arrived.
 *
 * Failure is logged and swallowed. The message is already committed and already
 * on its way to every open client; failing the subscriber would retry a
 * notification for a message people can already see.
 */
export default async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const conversationId = readString(record, 'conversationId')
  const messageId = readString(record, 'messageId')
  const senderUserId = readString(record, 'senderUserId')
  const tenantId = ctx.tenantId ?? null
  const organizationId = ctx.organizationId ?? null
  if (!conversationId || !messageId || !senderUserId || !tenantId || !organizationId) return

  const scope = { tenantId, organizationId }

  try {
    const container = ctx.container ?? { resolve: ctx.resolve }
    const em = container.resolve<EntityManager>('em').fork()

    const message = await em.findOne(ChatMessage, { id: messageId, ...scope })
    // A system row is the transcript's record of what happened to the
    // conversation, not something anybody said to anybody.
    if (!message || message.kind !== 'user' || message.deletedAt) return

    const conversation = await em.findOne(ChatConversation, { id: conversationId, ...scope })
    if (!conversation) return

    const participants = await em.find(ChatParticipant, { conversationId, ...scope })
    const isSpace = conversation.kind === 'space'

    let candidates: ChatParticipant[]
    if (isSpace) {
      if (message.mentionsEveryone) {
        candidates = participants
      } else {
        const mentions = await em.find(ChatMessageMention, { messageId, ...scope })
        const named = new Set(mentions.map((mention) => mention.mentionedUserId))
        candidates = participants.filter((participant) => named.has(participant.userId))
      }
    } else {
      candidates = participants
    }

    const recipients = candidates.filter((participant) => {
      if (participant.userId === senderUserId) return false
      if (participant.mutedAt) return false
      // Already read it — they had the conversation open as it arrived.
      if (participant.lastReadAt && participant.lastReadAt >= message.createdAt) return false
      return true
    })
    if (recipients.length === 0) return

    const typeId = isSpace ? 'chat.mention.received' : 'chat.direct.received'
    const typeDef = notificationTypes.find((type) => type.type === typeId)
    if (!typeDef) return

    const notificationService = resolveNotificationService(container)
    const senderName = await resolveSenderName(em, scope, senderUserId)

    for (const recipient of recipients) {
      /**
       * One notification per conversation per person, replaced rather than
       * stacked.
       *
       * `groupKey` keyed on the conversation and the reader — not on the message
       * — so a colleague sending five messages while you are away leaves one
       * "you have messages here" rather than five entries to dismiss one by one.
       */
      const input = buildNotificationFromType(typeDef, {
        recipientUserId: recipient.userId,
        bodyVariables: {
          sender: senderName,
          conversation: conversation.title ?? senderName,
        },
        sourceEntityType: 'chat:chat_conversation',
        sourceEntityId: conversationId,
        linkHref: `/backend/chat/${conversationId}`,
        groupKey: `${typeId}:${conversationId}:${recipient.userId}`,
      })
      await notificationService.create(input, { tenantId, organizationId })
    }
  } catch (error) {
    logger.warn('could not raise a chat notification', {
      conversationId,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * The sender's display name, or a neutral stand-in.
 *
 * A notification that says "Someone sent you a message" is still useful; one
 * that fails to be created because a directory lookup missed is not.
 */
async function resolveSenderName(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  senderUserId: string,
): Promise<string> {
  try {
    const { loadOrganizationMember } = await import('../lib/scope')
    const member = await loadOrganizationMember(em, scope, senderUserId)
    return member?.name ?? 'Someone'
  } catch {
    return 'Someone'
  }
}
