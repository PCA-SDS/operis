import type { EntityManager } from '@mikro-orm/postgresql'
import { findEntityIdsBySearchTokens } from '@open-mercato/shared/lib/search/tokenLookup'
import { createSearchTokenAvailability } from '@open-mercato/shared/lib/search/availability'
import type { SearchTokenProbeDb } from '@open-mercato/shared/lib/search/availability'
import type { SearchTokenDatabase } from '@open-mercato/shared/lib/search/tokenLookup'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { Role, User, UserRole } from '../../auth/data/entities'
import type { ChatDirectoryEntryDto } from '../data/types'
import { activeOrganizationMemberFilter, chatDisplayName, type ChatScope } from './scope'

/** Never return more than this many people from one search. */
export const DIRECTORY_RESULT_LIMIT = 25

/**
 * The fallback scan window.
 *
 * The search-token index is the primary path and needs no scan at all. This cap
 * only bounds the degraded path — an instance with search disabled, or a tenant
 * whose users have not been indexed yet — where the only way to match encrypted
 * columns is to decrypt and compare. It is deliberately small: a request that
 * decrypts thousands of rows is an availability problem, not a feature.
 */
const DIRECTORY_FALLBACK_SCAN_LIMIT = 200

export type ChatDirectoryResult = {
  items: ChatDirectoryEntryDto[]
  /**
   * True when the answer came from the bounded fallback scan rather than the
   * token index, so results may be incomplete. The UI says so rather than
   * implying it searched everyone.
   */
  truncated: boolean
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Role names per user, so a search for "warehouse" finds the people in that
 * role and each result row can say who someone is.
 */
async function loadRoleNames(em: EntityManager, userIds: readonly string[]): Promise<Map<string, string[]>> {
  const unique = [...new Set(userIds)]
  const byUser = new Map<string, string[]>()
  if (unique.length === 0) return byUser

  const links = await em.find(UserRole, { user: { $in: unique as string[] }, deletedAt: null }, { populate: ['role'] })
  for (const link of links) {
    const userId = typeof link.user === 'string' ? link.user : link.user?.id
    const role = typeof link.role === 'string' ? null : (link.role as Role | undefined)
    if (!userId || !role?.name) continue
    const bucket = byUser.get(userId)
    if (bucket) bucket.push(role.name)
    else byUser.set(userId, [role.name])
  }
  for (const names of byUser.values()) names.sort((a, b) => a.localeCompare(b))
  return byUser
}

function toEntries(
  users: User[],
  roleNames: Map<string, string[]>,
  limit: number,
): ChatDirectoryEntryDto[] {
  return users
    .map((user) => ({
      id: user.id,
      name: chatDisplayName(user),
      email: user.email,
      roleNames: roleNames.get(user.id) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)
}

/**
 * People in the caller's organization that they can start a conversation with.
 *
 * `User.name` and `User.email` are encrypted with a per-value IV, so no SQL
 * predicate can match them. Rather than decrypt the organization and filter in
 * memory, this resolves candidate ids through the shared `search_tokens` index —
 * the same encryption-safe path `/api/auth/users` uses — and then decrypts only
 * the handful of rows it is about to return.
 *
 * Three properties this guarantees, all enforced here rather than in the UI:
 *
 * - the caller never appears in their own results;
 * - nobody outside `scope` appears, so the endpoint cannot be used to enumerate
 *   another tenant or another organization;
 * - an empty query returns a bounded first page of colleagues, which is what
 *   makes the "Start a chat" panel useful before you type.
 */
export async function searchOrganizationDirectory(
  em: EntityManager,
  scope: ChatScope,
  options: { query: string; excludeUserId: string; limit?: number },
): Promise<ChatDirectoryResult> {
  const limit = Math.min(Math.max(options.limit ?? DIRECTORY_RESULT_LIMIT, 1), DIRECTORY_RESULT_LIMIT)
  const needle = options.query.trim()
  const memberFilter = activeOrganizationMemberFilter(scope)

  // No query: a bounded first page, so opening the picker costs a handful of
  // decrypts rather than the whole organization.
  if (!needle) {
    const users = await findWithDecryption(
      em,
      User,
      { ...memberFilter, id: { $ne: options.excludeUserId } },
      { orderBy: { createdAt: 'asc' }, limit },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    const roleNames = await loadRoleNames(em, users.map((user) => user.id))
    return { items: toEntries(users, roleNames, limit), truncated: false }
  }

  // The index stores hashes of the plaintext, so it keeps matching where an
  // `ilike` over ciphertext would silently match nothing.
  // The precise variant, not `…Compat`: that shim collapses "the index was not
  // consulted" into an empty array, which this code would read as "nobody
  // matched" and answer with a confidently wrong empty list.
  const lookup = await findEntityIdsBySearchTokens({
    db: em.getKysely<SearchTokenDatabase>(),
    entityType: E.auth.user,
    query: needle,
    scope: { tenantId: scope.tenantId },
  })

  if (lookup.matched) {
    // An empty result from the index means one of two very different things:
    // nobody matches, or this entity type was never indexed. On a deployment
    // where `auth:user` has no `search_tokens` rows — the state of any install
    // that has not reindexed users — trusting it answered "no colleague called
    // Sarah" to every query of three characters or more, while one- and
    // two-character queries worked because they produce no tokens and fall
    // through to the scan below. Confirming the entity type is actually indexed
    // is what separates the two; the probe is a prefix seek on
    // `search_tokens_presence_idx` with a process-level TTL cache, so the miss
    // costs the same as the hit.
    if (lookup.ids.length === 0) {
      const availability = createSearchTokenAvailability({
        // The same structural cast the query engine uses: the probe type is
        // deliberately minimal so it does not depend on a Kysely schema.
        getDb: () => em.getKysely() as unknown as SearchTokenProbeDb,
        getConfig: () => ({ enabled: true }),
        // The lookup above is already tenant-scoped and the org filter runs in
        // SQL on the user query, so the probe only asks "is this entity type
        // indexed for this tenant at all".
        applyOrganizationScope: (query) => query,
        logDebug: () => undefined,
      })
      const indexed = await availability.hasTokens(E.auth.user, scope.tenantId)
      if (indexed) return { items: [], truncated: false }
    } else {
      // The index is tenant-scoped, not organization-scoped, so the org filter
      // still runs in SQL here — an id that matched in a sibling organization is
      // dropped by the database, not by this code.
      const users = await findWithDecryption(
        em,
        User,
        { ...memberFilter, id: { $in: lookup.ids.filter((id) => id !== options.excludeUserId) } },
        { limit },
        { tenantId: scope.tenantId, organizationId: scope.organizationId },
      )
      const roleNames = await loadRoleNames(em, users.map((user) => user.id))
      return { items: toEntries(users, roleNames, limit), truncated: false }
    }
  }

  // Degraded path: the token index was not consulted (search disabled, or this
  // tenant has no tokens yet). Compare in memory over a small window — one of
  // the three sanctioned answers for ciphertext columns — and tell the caller
  // the answer may be partial.
  const scanned = await findWithDecryption(
    em,
    User,
    memberFilter,
    { orderBy: { createdAt: 'asc' }, limit: DIRECTORY_FALLBACK_SCAN_LIMIT + 1 },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  const truncated = scanned.length > DIRECTORY_FALLBACK_SCAN_LIMIT
  const candidates = (truncated ? scanned.slice(0, DIRECTORY_FALLBACK_SCAN_LIMIT) : scanned).filter(
    (user) => user.id !== options.excludeUserId,
  )
  const roleNames = await loadRoleNames(em, candidates.map((user) => user.id))
  const lowered = normalize(needle)
  const matched = candidates.filter((user) => {
    if (normalize(chatDisplayName(user)).includes(lowered)) return true
    if (normalize(user.email).includes(lowered)) return true
    return (roleNames.get(user.id) ?? []).some((role) => normalize(role).includes(lowered))
  })

  return { items: toEntries(matched, roleNames, limit), truncated }
}
