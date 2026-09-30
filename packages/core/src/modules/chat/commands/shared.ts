import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { forbidden, notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ChatExternalContact, ChatMessage, ChatMessagingAccount, ChatParticipant } from '../data/entities'
import { emitChatEvent, type ChatEventId } from '../events'
import { loadChatMessages } from '../lib/messages'
import { requireIdentityId, type ChatActor } from '../lib/participants'
import { loadOrganizationMember, type ChatScope } from '../lib/scope'
import { loadConversationContext } from '../lib/spaces'
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

/**
 * Who is acting: the logged-in colleague, or — only when the transport's
 * projector says so — an outsider or the messaging account itself.
 *
 * Those two arms are read from `externalOrigin`, which HTTP routes never
 * populate: they build command input field by field. So neither can act except
 * through the projector, and a client cannot post as a customer or as the
 * company's phone.
 */
export async function resolveChatActor(
  ctx: CommandRuntimeContext,
  externalOrigin: { externalContactId?: string | null; senderAccountId?: string | null } | undefined,
): Promise<ChatActor> {
  const externalContactId = externalOrigin?.externalContactId
  if (externalContactId) return { kind: 'external', externalContactId }
  const accountId = externalOrigin?.senderAccountId
  if (accountId) return { kind: 'account', accountId }
  return { kind: 'user', userId: await actingUserId(ctx) }
}

/**
 * Who the actor is, verified for this organization — or null.
 *
 * A colleague must still be an active member: a participant row outlives the
 * membership that created it. An outsider must be a contact of this
 * organization, read through decryption because the name is personal data.
 */
export async function loadActorIdentity(
  em: EntityManager,
  scope: ChatScope,
  actor: ChatActor,
): Promise<{ name: string; network: string | null } | null> {
  if (actor.kind === 'user') {
    const member = await loadOrganizationMember(em, scope, actor.userId)
    return member ? { name: member.name, network: null } : null
  }
  if (actor.kind === 'account') {
    // Deleted accounts included: a phone may still report an edit or a delete
    // that happened just before its account was removed.
    const account = await findOneWithDecryption(
      em,
      ChatMessagingAccount,
      {
        id: requireIdentityId(actor.accountId),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      {},
      scope,
    )
    return account ? { name: account.displayName, network: account.network } : null
  }
  const contact = await findOneWithDecryption(
    em,
    ChatExternalContact,
    {
      id: requireIdentityId(actor.externalContactId),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    {},
    scope,
  )
  return contact ? { name: contact.displayName, network: contact.network } : null
}

/**
 * Everyone in a conversation, and which of them own it.
 *
 * One query for both, because the role sits on the row the audience is already
 * read from — and the send path needs the owners to seat them at the room's
 * moderation power level, which it previously could not name and so passed as
 * an empty list.
 *
 * `userIds` and `ownerUserIds` are colleagues only: they are the SSE audience
 * and the room roster, and an outsider has neither a session nor an Operis
 * identity to seat. Outsiders are reported apart, in `externalContactIds`, so a
 * null can never reach `recipientUserIds`.
 */
export async function conversationRoster(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
): Promise<{ userIds: string[]; ownerUserIds: string[]; externalContactIds: string[] }> {
  const participants = await em.find(ChatParticipant, {
    conversationId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const userIds: string[] = []
  const ownerUserIds: string[] = []
  const externalContactIds: string[] = []
  for (const participant of participants) {
    if (participant.userId) {
      userIds.push(participant.userId)
      if (participant.role === 'owner') ownerUserIds.push(participant.userId)
    } else if (participant.externalContactId) {
      externalContactIds.push(participant.externalContactId)
    }
  }
  return { userIds, ownerUserIds, externalContactIds }
}

/** The user ids of everyone in a conversation — the SSE audience. */
export async function conversationAudience(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
): Promise<string[]> {
  return (await conversationRoster(em, scope, conversationId)).userIds
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
  /**
   * A registration that fails to resolve is NOT a missing one.
   *
   * Swallowing the error here defeated the whole point of `chat_matrix/di.ts`
   * refusing to boot without a homeserver: the module registered a factory that
   * threw when called, every send silently fell back to `local`, and the only
   * outward sign was a homeserver that received nothing. Rethrow with the token
   * named, and let the deployment fail the way it was designed to.
   */
  return container.resolve<ChatTransport>('chatTransport')
}

/**
 * The message must live in the conversation the caller named, and the caller
 * must be in that conversation.
 *
 * Both halves matter. `loadConversationContext` proves membership — for a
 * colleague or, on the projector's path, an outsider — and answers 404 for a
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
  actor: ChatActor,
  options: { includeDeleted?: boolean } = {},
) {
  const context = await loadConversationContext(em, scope, conversationId, actor)
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
