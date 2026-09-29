import type { EntityManager } from '@mikro-orm/postgresql'
import { ChatParticipant } from '../data/entities'
import type { ChatScope } from './scope'

/**
 * Who is acting in a conversation: a colleague, or an outsider (an external
 * contact) — and an outsider only ever on the transport's projector path.
 */
export type ChatActor =
  | { kind: 'user'; userId: string }
  | { kind: 'external'; externalContactId: string }

/**
 * An id a participant lookup may filter on, or an internal error.
 *
 * `chat_participants.user_id` and `external_contact_id` are nullable, and
 * MikroORM compiles a filter value of `null` — and of `undefined`, which
 * `findOne` normalises to `null` — to `IS NULL`. A lookup by a missing user id
 * would therefore match every outsider's row and make its caller a member of any
 * conversation with an outsider in it. Refusing before the query runs is the
 * only place that cannot be forgotten.
 */
export function requireIdentityId(id: string | null | undefined): string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('[internal] chat participant lookup without an identity id')
  }
  return id
}

/**
 * Whether the actor wrote the message. Compared per arm: `senderUserId` alone
 * would call every outsider the author of every other outsider's message, since
 * both carry null there.
 */
export function isAuthorOf(
  message: { senderUserId: string | null; senderExternalContactId?: string | null },
  actor: ChatActor,
): boolean {
  if (actor.kind === 'user') return message.senderUserId !== null && message.senderUserId === actor.userId
  return (message.senderExternalContactId ?? null) !== null && message.senderExternalContactId === actor.externalContactId
}

/**
 * The actor's own row in a conversation, or null — the one way to ask "is this
 * person in it". Each arm filters on its own column; neither can match the
 * other's rows.
 */
export async function loadParticipant(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
  actor: ChatActor,
): Promise<ChatParticipant | null> {
  const identity =
    actor.kind === 'user'
      ? { userId: requireIdentityId(actor.userId) }
      : { externalContactId: requireIdentityId(actor.externalContactId) }
  return em.findOne(ChatParticipant, {
    conversationId: requireIdentityId(conversationId),
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    ...identity,
  })
}
