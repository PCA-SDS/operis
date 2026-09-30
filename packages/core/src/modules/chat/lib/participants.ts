import type { EntityManager } from '@mikro-orm/postgresql'
import { ChatParticipant } from '../data/entities'
import type { ChatScope } from './scope'

/**
 * Who is acting in a conversation: a colleague, an outsider (an external
 * contact), or the messaging account itself — the company's phone, sending,
 * editing or deleting on WhatsApp directly. The last two only ever on the
 * transport's projector path.
 *
 * The account has no seat in the conversation: it speaks for it. It may act
 * only in a conversation that came in through it (`lib/spaces.ts`).
 */
export type ChatActor =
  | { kind: 'user'; userId: string }
  | { kind: 'external'; externalContactId: string }
  | { kind: 'account'; accountId: string }

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
  message: {
    senderUserId: string | null
    senderExternalContactId?: string | null
    senderAccountId?: string | null
    visibility?: string
  },
  actor: ChatActor,
): boolean {
  if (actor.kind === 'user') return message.senderUserId !== null && message.senderUserId === actor.userId
  if (actor.kind === 'account') {
    // On the network, everything that left through the account is the account's
    // own message — a colleague's reply included. So the phone may edit or
    // delete it there, and Operis follows. An outsider's message never is, and
    // nor is an internal note, which never left.
    if (message.visibility === 'internal') return false
    return (
      (message.senderAccountId ?? null) === actor.accountId ||
      (message.senderUserId !== null && (message.senderExternalContactId ?? null) === null)
    )
  }
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
  // The account never has a row; see `loadConversationContext`.
  if (actor.kind === 'account') return null
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
