import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { ChatConversation, ChatMessage } from '../data/entities'
import { dbNow } from '../lib/clock'
import { buildMessagePreview } from '../lib/conversations'
import { loadChatMessages } from '../lib/messages'
import type { ChatScope } from '../lib/scope'
import { loadOrganizationMember } from '../lib/scope'
import { loadSpaceContext } from '../lib/spaces'
import {
  actingUserId,
  conversationAudience,
  emitConversationEvent,
  ensureOrganizationScope,
  ensureTenantScope,
  forkEm,
} from './shared'

/**
 * A card row: a place in the transcript for something that lives outside chat.
 *
 * It is a `kind: 'system'` row with `systemEvent: 'card'` and an **empty body**,
 * and every one of those three choices is doing work:
 *
 * - **Empty body.** Nothing belonging to the owning module can reach
 *   `search_body`, the conversation preview, the translation cache or the
 *   outbound transport, so a card cannot become the leak that shows a task's
 *   title to someone who may not read that task. The card is rendered per viewer
 *   from an authorized read of the real record instead.
 * - **`system`, not `user`.** System rows are already excluded from the unread
 *   predicate, so posting a card does not manufacture unread activity for
 *   everyone in the conversation, and they are already not editable — nobody can
 *   rewrite a card into something it does not point at.
 * - **A row at all**, rather than a side list. The reference belongs in the
 *   conversation's own timeline, in the place the conversation was when someone
 *   asked for it.
 *
 * This is **not** a second send path. It writes no body, validates no mentions,
 * indexes no links, stages no attachments and publishes nothing to the transport
 * — there is nothing of `chat.messages.send` to share. It is the same shape as
 * the membership rows `commands/spaces.ts` already appends, generalized so a
 * module other than chat can ask for one.
 */
export type AppendChatCardInput = {
  tenantId: string
  organizationId: string
  conversationId: string
}

export type AppendChatCardResult = {
  messageId: string
  createdAt: string
}

const appendChatCardCommand: CommandHandler<AppendChatCardInput, AppendChatCardResult> = {
  id: 'chat.messages.appendCard',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const messages = await loadChatMessages()
    const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const senderUserId = await actingUserId(ctx)
    const em = forkEm(ctx)

    // The same two checks every write makes, in the same order: the caller must
    // still be an active member of this organization, and must still be in this
    // conversation. Membership yesterday is not authorization today.
    const sender = await loadOrganizationMember(em, scope, senderUserId)
    if (!sender) throw notFound(messages.conversationNotFound)

    const audience = await conversationAudience(em, scope, input.conversationId)
    if (!audience.includes(senderUserId)) throw notFound(messages.conversationNotFound)

    const stored = await em.transactional(async (tx) => {
      const now = await dbNow(tx)

      // Re-read under the full scope inside the transaction, exactly as the send
      // path does: the row was checked outside it, and this is what stops a card
      // landing in a conversation that has since been deleted.
      const conversation = await tx.findOne(ChatConversation, {
        id: input.conversationId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (!conversation) throw notFound(messages.conversationNotFound)

      const message = tx.create(ChatMessage, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        conversationId: conversation.id,
        senderUserId,
        kind: 'system',
        systemEvent: 'card',
        // Empty, and `searchBody` left null with it — see the note above. A card
        // that is not searchable is the point, not an omission.
        body: '',
        createdAt: now,
        updatedAt: now,
      })
      tx.persist(message)

      // A card is activity: the conversation rises in the list. The preview stays
      // empty, the way a membership event's does, because there is no sentence to
      // show that would be true for every reader and safe for all of them.
      conversation.lastMessageAt = now
      conversation.lastMessagePreview = ''
      conversation.lastMessageSenderUserId = senderUserId

      await tx.flush()
      return message
    })

    // A pointer, as every chat frame is, and scoped to the conversation's live
    // members. The card's own contents are fetched per viewer over an authorized
    // route; nothing about what it points at travels here.
    await emitConversationEvent('chat.message.sent', scope, audience, {
      conversationId: input.conversationId,
      messageId: stored.id,
      senderUserId,
      createdAt: stored.createdAt.toISOString(),
      card: true,
    })

    return { messageId: stored.id, createdAt: stored.createdAt.toISOString() }
  },
}

registerCommand(appendChatCardCommand)

/**
 * Take a card row back out of the transcript.
 *
 * Soft-deleted through this command rather than `chat.messages.delete` because
 * that one refuses system rows on purpose — a membership event is the
 * transcript's record of what happened and nobody may rewrite history. A card is
 * different: it is a reference somebody added, and removing the reference is a
 * normal thing to want. It is still not the same act as unlinking the record or
 * deleting it, and this command does neither.
 *
 * Only the person who posted the card, or an owner of the space it sits in, as
 * with any other deletion here.
 */
export type RemoveChatCardInput = {
  tenantId: string
  organizationId: string
  conversationId: string
  messageId: string
}

export type RemoveChatCardResult = {
  messageId: string
  deletedAt: string
}

const removeChatCardCommand: CommandHandler<RemoveChatCardInput, RemoveChatCardResult> = {
  id: 'chat.messages.removeCard',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const messages = await loadChatMessages()
    const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const actorUserId = await actingUserId(ctx)
    const em = forkEm(ctx)

    const context = await loadSpaceContext(em, scope, input.conversationId, actorUserId)

    const message = await em.findOne(ChatMessage, {
      id: input.messageId,
      conversationId: input.conversationId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      kind: 'system',
      systemEvent: 'card',
    })
    if (!message) throw notFound(messages.messageNotFound)

    // Already gone converges rather than 404ing, for the same reason a second
    // message delete does: two people holding a stale transcript can both press
    // remove, and telling the second one the card is missing reports a failure
    // for exactly the state they asked for.
    if (message.deletedAt) {
      return { messageId: message.id, deletedAt: message.deletedAt.toISOString() }
    }

    const isAuthor = message.senderUserId === actorUserId
    const isOwner = context.participant.role === 'owner'
    if (!isAuthor && !isOwner) throw notFound(messages.messageNotFound)

    const audience = await conversationAudience(em, scope, input.conversationId)
    const deletedAt = await em.transactional(async (tx) => {
      const now = await dbNow(tx)
      const row = await tx.findOne(ChatMessage, { id: message.id })
      if (!row) throw notFound(messages.messageNotFound)
      row.deletedAt = now

      // The list must not advertise activity a reader cannot find. Repoint the
      // denormalized columns at whatever is newest now, the way the message
      // delete path does.
      const conversation = await tx.findOne(ChatConversation, {
        id: input.conversationId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      if (conversation && conversation.lastMessageAt.getTime() === row.createdAt.getTime()) {
        const latest = await tx.find(
          ChatMessage,
          {
            conversationId: input.conversationId,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            deletedAt: null,
          },
          { orderBy: { createdAt: 'desc', id: 'desc' }, limit: 1 },
        )
        const newest = latest[0] ?? null
        conversation.lastMessageAt = newest?.createdAt ?? conversation.createdAt
        conversation.lastMessagePreview = newest ? buildMessagePreview(newest.body) : null
        conversation.lastMessageSenderUserId = newest?.senderUserId ?? null
      }

      await tx.flush()
      return now
    })

    await emitConversationEvent('chat.message.deleted', scope, audience, {
      conversationId: input.conversationId,
      messageId: message.id,
      card: true,
    })

    return { messageId: message.id, deletedAt: deletedAt.toISOString() }
  },
}

registerCommand(removeChatCardCommand)
