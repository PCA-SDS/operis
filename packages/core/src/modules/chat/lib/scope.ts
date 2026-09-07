import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '../../auth/data/entities'

/**
 * The tenant + organization pair every chat read and write is pinned to. It is
 * always derived from the session, never from a request body.
 */
export type ChatScope = {
  tenantId: string
  organizationId: string
}

export type ChatPerson = {
  id: string
  name: string
  email: string
}

/**
 * Who is allowed to be in an organization's conversations.
 *
 * A user row carries exactly one `organization_id` — Operis has no membership
 * join table — and `sessionIntegrity` rejects a token whose `orgId` has drifted
 * from that column. So membership is one equality check, and a user moved to
 * another organization loses access on their next request with no bookkeeping
 * here.
 *
 * `User` has no `isActive` column: active means undeleted and confirmed. An
 * unconfirmed account cannot sign in, so offering it as a chat partner would
 * promise a reply that can never come.
 */
export function activeOrganizationMemberFilter(scope: ChatScope): Record<string, unknown> {
  return {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
    isConfirmed: true,
  }
}

/** `name` when the person set one, otherwise the address they sign in with. */
export function chatDisplayName(user: { name?: string | null; email: string }): string {
  const trimmed = (user.name ?? '').trim()
  return trimmed.length > 0 ? trimmed : user.email
}

/**
 * Load the active organization members among `ids`, dropping every id that is
 * not one. Callers treat a missing id as "not a valid participant" rather than
 * as an error, so one stale id cannot fail a whole conversation list.
 *
 * `User.email` is encrypted at rest, so this goes through `findWithDecryption`
 * rather than `em.find`.
 */
export async function loadOrganizationMembers(
  em: EntityManager,
  scope: ChatScope,
  ids: readonly string[],
): Promise<Map<string, ChatPerson>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  const result = new Map<string, ChatPerson>()
  if (unique.length === 0) return result

  const users = await findWithDecryption(
    em,
    User,
    { ...activeOrganizationMemberFilter(scope), id: { $in: unique } },
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  for (const user of users) {
    result.set(user.id, { id: user.id, name: chatDisplayName(user), email: user.email })
  }
  return result
}

/**
 * Load one active organization member, or `null`.
 *
 * This is the single predicate that answers "may these two people talk?", and
 * it is applied to the caller as well as to the person they picked — a
 * super-admin scoped into an organization they do not belong to is not a member
 * of it and cannot join its conversations.
 */
export async function loadOrganizationMember(
  em: EntityManager,
  scope: ChatScope,
  userId: string,
): Promise<ChatPerson | null> {
  const members = await loadOrganizationMembers(em, scope, [userId])
  return members.get(userId) ?? null
}
