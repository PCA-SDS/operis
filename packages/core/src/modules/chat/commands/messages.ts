import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { badRequest, isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import { ChatConversation, ChatMessage, ChatMessageMention, ChatParticipant } from '../data/entities'
import type { ChatMessageDto, ChatReplyTargetDto } from '../data/types'
import { buildMessagePreview } from '../lib/conversations'
import { extractMentionedUserIds, mentionsEveryone } from '../lib/mentions'
import { resolveReplyTarget } from '../lib/replies'
import { loadChatMessages } from '../lib/messages'
import { dbNow } from '../lib/clock'
import { loadOrganizationMember, loadOrganizationMembers, type ChatScope } from '../lib/scope'
import {
  actingUserId,
  conversationAudience,
  emitConversationEvent,
  ensureOrganizationScope,
  ensureTenantScope,
  forkEm,
} from './shared'

export type SendChatMessageInput = {
  tenantId: string
  organizationId: string
  conversationId: string
  body: string
  clientMessageId?: string
  replyToMessageId?: string
}

export type SendChatMessageResult = {
  message: ChatMessageDto
  deduplicated: boolean
}

function toDto(
  message: ChatMessage,
  replyTo: ChatReplyTargetDto | null,
  senderName: string,
  mentionNames: Record<string, string> = {},
): ChatMessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderUserId: message.senderUserId,
    senderName,
    kind: message.kind,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    clientMessageId: message.clientMessageId ?? null,
    replyTo,
    systemEvent: message.systemEvent ?? null,
    systemTargetUserId: message.systemTargetUserId ?? null,
    // A send is always a user message, so there is never a membership target to
    // name here.
    systemTargetName: null,
    // A message cannot be reacted to or pinned before it exists, so the sender's
    // optimistic copy starts empty and picks the rest up on the next read.
    reactions: [],
    mentionNames,
    mentionsEveryone: message.mentionsEveryone,
    pinned: false,
  }
}

async function findByClientId(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
  clientMessageId: string,
): Promise<ChatMessage | null> {
  return em.findOne(ChatMessage, {
    conversationId,
    clientMessageId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
}

/**
 * Append a message to a conversation the caller is part of.
 *
 * Three things this is careful about:
 *
 * - **Authorship** comes from the session, never the payload.
 * - **Idempotency**: a `clientMessageId` is checked before the write and again
 *   after a unique violation, so a composer that retries a timed-out request
 *   gets the message it already sent rather than posting it twice.
 * - **Membership is re-checked on every send.** A conversation the caller was
 *   part of yesterday is not authorization for today — if they have since left
 *   the organization, the participant row is still there but the membership
 *   check is not satisfied.
 */
const sendChatMessageCommand: CommandHandler<SendChatMessageInput, SendChatMessageResult> = {
  id: 'chat.messages.send',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const messages = await loadChatMessages()
    const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const senderUserId = await actingUserId(ctx)
    const em = forkEm(ctx)

    const sender = await loadOrganizationMember(em, scope, senderUserId)
    if (!sender) throw badRequest(messages.notOrganizationMember)

    const participant = await em.findOne(ChatParticipant, {
      conversationId: input.conversationId,
      userId: senderUserId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!participant) throw notFound(messages.conversationNotFound)

    const conversation = await em.findOne(ChatConversation, {
      id: input.conversationId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!conversation) throw notFound(messages.conversationNotFound)

    if (input.clientMessageId) {
      const existing = await findByClientId(em, scope, conversation.id, input.clientMessageId)
      if (existing) {
        return {
          message: toDto(existing, await resolveReplyTarget(em, scope, existing), sender.name),
          deduplicated: true,
        }
      }
    }

    // The reply target must be a live message in THIS conversation. The composite
    // foreign key would refuse a cross-conversation id anyway, but a 23503 is a
    // 500 to the caller — checking here turns a forged or stale id into the 404
    // it actually is, and catches the soft-deleted case the constraint cannot see.
    if (input.replyToMessageId) {
      const target = await em.findOne(ChatMessage, {
        id: input.replyToMessageId,
        conversationId: conversation.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (!target) throw notFound(messages.replyTargetNotFound)
    }

    /**
     * Mentions are validated against the conversation, never trusted from the
     * client.
     *
     * The body arrives carrying `<@id>` tokens the composer wrote. Each one must
     * name somebody who is actually in this conversation: a forged id belonging
     * to another space, another organization, or nobody at all is refused rather
     * than stored — otherwise the mention table would become a way to make a
     * stranger's client fetch a conversation, and `@everyone` a way to reach
     * outside the room.
     *
     * `@everyone` is refused in a direct conversation, where it would mean the
     * one person already reading it.
     */
    const participantIds = await conversationAudience(em, scope, conversation.id)
    const mentionedUserIds = extractMentionedUserIds(input.body)
    const everyone = mentionsEveryone(input.body)

    if (everyone && conversation.kind !== 'space') throw badRequest(messages.everyoneNotAllowed)
    if (mentionedUserIds.length > 0) {
      const inConversation = new Set(participantIds)
      const outsiders = mentionedUserIds.filter((userId) => !inConversation.has(userId))
      if (outsiders.length > 0) throw badRequest(messages.mentionNotAllowed)
      // And they must still be active people, not stale participant rows.
      const mentioned = await loadOrganizationMembers(em, scope, mentionedUserIds)
      if (mentioned.size !== mentionedUserIds.length) throw badRequest(messages.mentionNotAllowed)
    }

    // Re-check the OTHER side too, not just the sender.
    //
    // A participant row outlives the membership that created it, so a colleague
    // who has left the organization still looks like a valid recipient.
    //
    // What happens next depends on the kind, because the same fact means
    // different things:
    //
    // - In a DIRECT conversation the departed person is the only counterpart, so
    //   the conversation has quietly become one-way. Refusing is what stops
    //   someone typing sensitive material into it.
    // - In a SPACE they are one of many. Refusing would let a single departed
    //   colleague silently break the space for everyone still in it, which is a
    //   far worse failure than not delivering to someone who cannot sign in
    //   anyway. They are dropped from the audience instead.
    //
    // One batched lookup either way, never one per recipient.
    const counterpartIds = participantIds.filter((userId) => userId !== senderUserId)
    const counterparts = await loadOrganizationMembers(em, scope, counterpartIds)
    if (conversation.kind === 'direct' && counterparts.size !== counterpartIds.length) {
      throw notFound(messages.recipientNotFound)
    }
    const recipients = [senderUserId, ...counterpartIds.filter((userId) => counterparts.has(userId))]

    let stored: ChatMessage
    try {
      // The message and the conversation's denormalized "latest" columns move
      // together; a preview that disagrees with the transcript is worse than no
      // preview at all.
      stored = await em.transactional(async (tx) => {
        // The database's clock, not this instance's. Every chat timestamp is
        // compared against one written by some other process, so a local
        // `new Date()` would make each instance's wall clock the authority.
        // Inside the transaction this is the transaction start time, so the
        // message and the conversation's denormalized copy share one instant.
        const now = await dbNow(tx)

        // Read first, then write, then flush once: a query issued after a
        // pending change on the same EntityManager can discard it.
        //
        // Re-read under the full scope rather than by bare id: the row was
        // validated outside the transaction, and re-checking here is what stops
        // a conversation deleted in between from having its preview updated.
        const target = await tx.findOne(ChatConversation, {
          id: conversation.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        })
        // The message and the conversation's "latest" columns are one unit. If
        // the conversation went away, abort rather than committing a message
        // into a conversation whose preview can never mention it.
        if (!target) throw notFound(messages.conversationNotFound)

        const message = tx.create(ChatMessage, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          conversationId: conversation.id,
          senderUserId,
          body: input.body,
          clientMessageId: input.clientMessageId ?? null,
          replyToMessageId: input.replyToMessageId ?? null,
          mentionsEveryone: everyone,
          createdAt: now,
          updatedAt: now,
        })
        tx.persist(message)

        // The mention rows land in the same transaction as the message, so a
        // half-written send can never leave a message that names nobody or a
        // mention pointing at nothing.
        await tx.flush()
        for (const mentionedUserId of mentionedUserIds) {
          tx.persist(
            tx.create(ChatMessageMention, {
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              messageId: message.id,
              conversationId: conversation.id,
              mentionedUserId,
              createdAt: now,
            }),
          )
        }

        target.lastMessageAt = now
        target.lastMessagePreview = buildMessagePreview(input.body)
        target.lastMessageSenderUserId = senderUserId
        // `updatedAt` is deliberately not set here: its `onUpdate` hook fires
        // unconditionally on flush and would overwrite anything assigned. That
        // is fine — `updated_at` is audit metadata and is never compared across
        // rows, unlike `last_message_at` above, which orders the list and so
        // must come from the shared clock.

        await tx.flush()
        return message
      })
    } catch (error) {
      // A retry that raced its own first attempt: the idempotency index rejected
      // the duplicate, so return the message that won.
      if (isUniqueViolation(error) && input.clientMessageId) {
        const retryEm = forkEm(ctx)
        const existing = await findByClientId(retryEm, scope, conversation.id, input.clientMessageId)
        if (existing) {
          return {
            message: toDto(existing, await resolveReplyTarget(retryEm, scope, existing), sender.name),
            deduplicated: true,
          }
        }
      }
      throw error
    }

    // Body deliberately absent: the bridge caps frames at 4KB and clients
    // refetch over the authorized route. `recipients` is what keeps this private
    // — the SSE endpoint drops the frame for everyone else.
    await emitConversationEvent('chat.message.sent', scope, recipients, {
      conversationId: conversation.id,
      messageId: stored.id,
      senderUserId,
      createdAt: stored.createdAt.toISOString(),
    })

    const mentionNames: Record<string, string> = {}
    if (mentionedUserIds.length > 0) {
      const mentioned = await loadOrganizationMembers(em, scope, mentionedUserIds)
      for (const userId of mentionedUserIds) {
        mentionNames[userId] = mentioned.get(userId)?.name ?? ''
      }
    }

    return {
      message: toDto(stored, await resolveReplyTarget(em, scope, stored), sender.name, mentionNames),
      deduplicated: false,
    }
  },
}

registerCommand(sendChatMessageCommand)
