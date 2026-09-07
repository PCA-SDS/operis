import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { forbidden, isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import { ChatMessage, ChatMessageReaction, ChatPinnedMessage } from '../data/entities'
import { dbNow } from '../lib/clock'
import { loadChatMessages } from '../lib/messages'
import type { ChatScope } from '../lib/scope'
import { loadSpaceContext } from '../lib/spaces'
import {
  actingUserId,
  conversationAudience,
  emitConversationEvent,
  ensureOrganizationScope,
  ensureTenantScope,
  forkEm,
} from './shared'

export type ToggleReactionInput = {
  tenantId: string
  organizationId: string
  conversationId: string
  messageId: string
  emoji: string
}

export type PinMessageInput = {
  tenantId: string
  organizationId: string
  conversationId: string
  messageId: string
}

/**
 * The message must live in the conversation the caller named, and the caller
 * must be in that conversation.
 *
 * Both halves matter. `loadSpaceContext` proves membership and answers 404 for a
 * conversation the caller is not in; re-reading the message under the SAME
 * conversation id proves the message belongs there. Without the second check a
 * forged id from another space would be reactable and pinnable by anyone who
 * happened to be in some conversation — the composite foreign keys would refuse
 * to store it, but as a 500 rather than the 404 it actually is.
 */
async function requireMessageInConversation(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
  messageId: string,
  userId: string,
) {
  const context = await loadSpaceContext(em, scope, conversationId, userId)
  const message = await em.findOne(ChatMessage, {
    id: messageId,
    conversationId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!message) throw notFound((await loadChatMessages()).messageNotFound)
  return { ...context, message }
}

/**
 * Add or remove one person's one emoji on one message.
 *
 * Deliberately a toggle rather than separate add and remove commands: the UI has
 * a single control, pressing it twice must land back where it started, and the
 * unique index makes "did I already react" a question the database answers.
 *
 * A 23505 from a racing second tab is treated as success — the reaction the
 * caller wanted is present, which is the whole contract — rather than surfacing
 * as a server error to someone who simply clicked twice.
 */
const toggleReactionCommand: CommandHandler<
  ToggleReactionInput,
  { emoji: string; reacted: boolean }
> = {
  id: 'chat.messages.toggleReaction',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const userId = await actingUserId(ctx)
    const em = forkEm(ctx)

    await requireMessageInConversation(em, scope, input.conversationId, input.messageId, userId)

    const existing = await em.findOne(ChatMessageReaction, {
      messageId: input.messageId,
      userId,
      emoji: input.emoji,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })

    let reacted: boolean
    if (existing) {
      em.remove(existing)
      await em.flush()
      reacted = false
    } else {
      try {
        const now = await dbNow(em)
        em.persist(
          em.create(ChatMessageReaction, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            messageId: input.messageId,
            conversationId: input.conversationId,
            userId,
            emoji: input.emoji,
            createdAt: now,
          }),
        )
        await em.flush()
      } catch (error) {
        // Another tab of the same person got there first. The reaction exists,
        // which is what was asked for.
        if (!isUniqueViolation(error)) throw error
      }
      reacted = true
    }

    const recipients = await conversationAudience(forkEm(ctx), scope, input.conversationId)
    await emitConversationEvent('chat.message.reacted', scope, recipients, {
      conversationId: input.conversationId,
      messageId: input.messageId,
    })

    return { emoji: input.emoji, reacted }
  },
}

/**
 * Pinning is shared furniture, so a space gates it on ownership.
 *
 * A pin changes what every member sees at the top of the conversation, which is
 * the same class of decision as renaming the space or changing who is in it —
 * and the module already has owners for exactly that. A direct conversation has
 * no owner and only two people, so either may pin.
 */
async function requirePinPermission(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
  messageId: string,
  userId: string,
) {
  const context = await requireMessageInConversation(em, scope, conversationId, messageId, userId)
  if (context.conversation.kind === 'space' && context.participant.role !== 'owner') {
    throw forbidden((await loadChatMessages()).notPinPermitted)
  }
  return context
}

const pinMessageCommand: CommandHandler<PinMessageInput, { pinned: boolean }> = {
  id: 'chat.messages.pin',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const userId = await actingUserId(ctx)
    const em = forkEm(ctx)

    await requirePinPermission(em, scope, input.conversationId, input.messageId, userId)

    try {
      const now = await dbNow(em)
      em.persist(
        em.create(ChatPinnedMessage, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          pinnedByUserId: userId,
          pinnedAt: now,
        }),
      )
      await em.flush()
    } catch (error) {
      // Already pinned — by this person a moment ago, or by another owner at the
      // same instant. Pinning something that is pinned is not an error.
      if (!isUniqueViolation(error)) throw error
    }

    const recipients = await conversationAudience(forkEm(ctx), scope, input.conversationId)
    await emitConversationEvent('chat.conversation.pinned', scope, recipients, {
      conversationId: input.conversationId,
      messageId: input.messageId,
    })

    return { pinned: true }
  },
}

const unpinMessageCommand: CommandHandler<PinMessageInput, { pinned: boolean }> = {
  id: 'chat.messages.unpin',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const userId = await actingUserId(ctx)
    const em = forkEm(ctx)

    await requirePinPermission(em, scope, input.conversationId, input.messageId, userId)

    const pin = await em.findOne(ChatPinnedMessage, {
      conversationId: input.conversationId,
      messageId: input.messageId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    // Unpinning something already unpinned converges rather than erroring, for
    // the same reason pinning twice does: two owners may press it at once.
    if (pin) {
      em.remove(pin)
      await em.flush()
    }

    const recipients = await conversationAudience(forkEm(ctx), scope, input.conversationId)
    await emitConversationEvent('chat.conversation.pinned', scope, recipients, {
      conversationId: input.conversationId,
      messageId: input.messageId,
    })

    return { pinned: false }
  },
}

registerCommand(toggleReactionCommand)
registerCommand(pinMessageCommand)
registerCommand(unpinMessageCommand)
