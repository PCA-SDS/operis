import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { ChatParticipant } from '../data/entities'
import { emitChatEvent, type ChatEventId } from '../events'
import { loadChatMessages } from '../lib/messages'
import type { ChatScope } from '../lib/scope'

export { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'

export function forkEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

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
