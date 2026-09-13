import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { forbidden, notFound } from '@open-mercato/shared/lib/crud/errors'
import { ChatMessage, ChatParticipant } from '../data/entities'
import { emitChatEvent, type ChatEventId } from '../events'
import { loadChatMessages } from '../lib/messages'
import type { ChatScope } from '../lib/scope'
import { loadSpaceContext } from '../lib/spaces'
import { createLocalChatTransport, type ChatTransport } from '../lib/transport'

export { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'

export { forkEm } from '@open-mercato/shared/lib/commands/helpers'

/**
 * The acting user, taken from the session rather than the payload.
 *
 * Authorship is the server's to decide. A client that named someone else as the
 * sender would be forging a message, so the command refuses to run without an
 * authenticated subject instead of falling back to an input field.
 */
export async function actingUserId(ctx: CommandRuntimeContext): Promise<string> {
  const subject = ctx.auth?.sub
  if (typeof subject === 'string' && subject.length > 0) return subject
  const messages = await loadChatMessages()
  throw forbidden(messages.unauthorized)
}

/** The user ids of everyone in a conversation — the SSE audience. */
export async function conversationAudience(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
): Promise<string[]> {
  const participants = await em.find(ChatParticipant, {
    conversationId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  return participants.map((participant) => participant.userId)
}

/**
 * Emit a chat event to exactly the people in the conversation.
 *
 * Two halves, and both matter:
 *
 * - trusted `{ tenantId, organizationId }` in the options, which makes the SSE
 *   endpoint ignore any tenant/organization the payload happens to carry;
 * - `recipientUserIds` in the payload, which is the only per-user targeting the
 *   bridge offers. Drop it and a private message becomes an org-wide broadcast.
 *
 * The payload deliberately carries no message body. The bridge truncates frames
 * over 4KB into an unusable stub and the cross-process bridge caps at 7KB, so
 * clients are told what changed and refetch it over the authorized route.
 */
export async function emitConversationEvent(
  eventId: ChatEventId,
  scope: ChatScope,
  recipientUserIds: readonly string[],
  payload: Record<string, unknown>,
): Promise<void> {
  if (recipientUserIds.length === 0) return
  await emitChatEvent(
    eventId,
    {
      ...payload,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      recipientUserIds: [...recipientUserIds],
    },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}

/**
 * The configured chat transport.
 *
 * Falls back to `local` when the token is absent rather than throwing. In a real
 * deployment `chat/di.ts` always registers it, so the fallback can only be
 * reached from a test harness that builds a partial container — and failing
 * those with a resolution error would be punishing them for not caring about a
 * transport that, by default, does nothing.
 */
export function chatTransportFrom(ctx: CommandRuntimeContext): ChatTransport {
  const container = ctx.container as AwilixContainer & { hasRegistration?: (name: string) => boolean }
  if (typeof container.hasRegistration === 'function' && !container.hasRegistration('chatTransport')) {
    return createLocalChatTransport()
  }
  try {
    return container.resolve<ChatTransport>('chatTransport')
  } catch {
    return createLocalChatTransport()
  }
}

/**
 * The message must live in the conversation the caller named, and the caller
 * must be in that conversation.
 *
 * Both halves matter. `loadSpaceContext` proves membership and answers 404 for a
 * conversation the caller is not in; re-reading the message under the SAME
 * conversation id proves the message belongs there. Without the second check a
 * forged id from another space would be reactable, pinnable, editable and
 * deletable by anyone who happened to be in some conversation — the composite
 * foreign keys would refuse to store a reaction or a pin, but as a 500 rather
 * than the 404 it actually is, and an edit writes to `chat_messages` itself,
 * where no constraint would catch it at all.
 *
 * `includeDeleted` relaxes the liveness filter and nothing else — the scope,
 * the conversation and the membership check are identical either way, so it
 * cannot widen who may act or on what. It exists for **deletion**, which must
 * converge rather than fail when the message is already gone: two people can
 * hold a stale transcript and both press delete, and telling the second one
 * "that message is no longer available" reports a failure for the exact state
 * they asked for. Every other caller wants the strict default — reacting to,
 * pinning or rewriting a deleted message is a real 404.
 */
export async function requireMessageInConversation(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
  messageId: string,
  userId: string,
  options: { includeDeleted?: boolean } = {},
) {
  const context = await loadSpaceContext(em, scope, conversationId, userId)
  const message = await em.findOne(ChatMessage, {
    id: messageId,
    conversationId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    ...(options.includeDeleted ? {} : { deletedAt: null }),
  })
  if (!message) throw notFound((await loadChatMessages()).messageNotFound)
  return { ...context, message }
}
