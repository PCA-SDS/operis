import type { EntityName } from '@mikro-orm/core'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { tryResolve } from '@open-mercato/shared/lib/di/tryResolve'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { extractPhoneDigits } from '@open-mercato/shared/lib/phone'
import { findEntityIdsBySearchTokens, type SearchTokenDatabase } from '@open-mercato/shared/lib/search/tokenLookup'
import type { ChatCustomerRefDto, ChatMemberListDto } from '../data/types'
import type { ChatParticipantAccess } from '../data/entities'
import { hasAccess } from './access'
import { callerHasChatFeatures } from './accounts'
import type { ChatScope } from './scope'

/**
 * Chat's view of the CRM — the `customers` module — as an optional peer.
 *
 * Chat never imports `customers`. It resolves the `CustomerEntity` class that
 * module registers in DI; when the module is not installed there is nothing to
 * resolve, and every function here answers "no CRM". What a colleague sees of a
 * record follows the CRM's own read permission for that kind of record.
 */

export type CustomerKind = 'person' | 'company'

export type CustomerSummary = { id: string; kind: CustomerKind; name: string }

type ContainerLike = { resolve: (name: string) => unknown }

type CustomerRecord = {
  id: string
  tenantId: string
  organizationId: string
  kind: string
  displayName: string
  primaryPhoneHash?: string | null
  deletedAt?: Date | null
  updatedAt?: Date | null
}

const VIEW_FEATURE: Record<CustomerKind, string> = {
  person: 'customers.people.view',
  company: 'customers.companies.view',
}

/** The CRM's entity id, as its search index knows it. */
const CUSTOMER_ENTITY_TYPE = 'customers:customer_entity'

/**
 * The context `customers` digests `primary_phone_hash` with. It is baked into
 * every stored hash, so it is as fixed as the column: changing it would orphan
 * the CRM's own phone lookups before it orphaned this one.
 */
const PHONE_HASH_CONTEXT = 'customers:customer_entity:primary_phone'

const SEARCH_LIMIT = 10
const MIN_PHONE_DIGITS = 6

function customerEntity(container: ContainerLike): EntityName<CustomerRecord> | null {
  return tryResolve<EntityName<CustomerRecord>>(container, 'CustomerEntity')
}

export function isCustomerKind(value: unknown): value is CustomerKind {
  return value === 'person' || value === 'company'
}

export function customerHref(kind: CustomerKind, id: string): string {
  return kind === 'person' ? `/backend/customers/people-v2/${id}` : `/backend/customers/companies-v2/${id}`
}

export function crmAvailable(container: ContainerLike): boolean {
  return customerEntity(container) !== null
}

/** The kinds of CRM record this colleague may open. Empty without a CRM. */
export async function viewableCustomerKinds(
  container: ContainerLike,
  userId: string,
  scope: ChatScope,
): Promise<Set<CustomerKind>> {
  const kinds = new Set<CustomerKind>()
  if (!crmAvailable(container)) return kinds
  for (const kind of ['person', 'company'] as const) {
    if (await callerHasChatFeatures(container, userId, scope, [VIEW_FEATURE[kind]])) kinds.add(kind)
  }
  return kinds
}

function summarize(record: CustomerRecord): CustomerSummary | null {
  return isCustomerKind(record.kind) ? { id: record.id, kind: record.kind, name: record.displayName } : null
}

function liveInScope(scope: ChatScope): { tenantId: string; organizationId: string; deletedAt: null } {
  return { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
}

/** Live records in this organization, by id. A deleted or foreign one is simply absent. */
export async function loadCustomers(
  em: EntityManager,
  container: ContainerLike,
  scope: ChatScope,
  ids: readonly string[],
): Promise<Map<string, CustomerSummary>> {
  const result = new Map<string, CustomerSummary>()
  const entity = customerEntity(container)
  const unique = [...new Set(ids)]
  if (!entity || unique.length === 0) return result
  const rows = await findWithDecryption(
    em,
    entity,
    { ...liveInScope(scope), id: { $in: unique } } as FilterQuery<CustomerRecord>,
    {},
    scope,
  )
  for (const row of rows) {
    const summary = summarize(row)
    if (summary) result.set(summary.id, summary)
  }
  return result
}

/**
 * The CRM person behind each of these numbers, matched on the CRM's own phone
 * digest — the stored number is encrypted, so equality is all there is.
 */
export async function customersByPhone(
  em: EntityManager,
  container: ContainerLike,
  scope: ChatScope,
  handles: readonly string[],
): Promise<Map<string, CustomerSummary>> {
  const result = new Map<string, CustomerSummary>()
  const entity = customerEntity(container)
  if (!entity) return result
  const handleOfHash = new Map<string, string>()
  for (const handle of new Set(handles)) {
    const digits = extractPhoneDigits(handle)
    if (digits.length < MIN_PHONE_DIGITS) continue
    for (const hash of lookupHashCandidates(digits, PHONE_HASH_CONTEXT)) handleOfHash.set(hash, handle)
  }
  if (handleOfHash.size === 0) return result
  const rows = await findWithDecryption(
    em,
    entity,
    { ...liveInScope(scope), kind: 'person', primaryPhoneHash: { $in: [...handleOfHash.keys()] } } as FilterQuery<CustomerRecord>,
    {},
    scope,
  )
  for (const row of rows) {
    const handle = row.primaryPhoneHash ? handleOfHash.get(row.primaryPhoneHash) : undefined
    const summary = summarize(row)
    if (handle && summary && !result.has(handle)) result.set(handle, summary)
  }
  return result
}

/** Records of the kinds the caller may open whose name — or number — matches. */
export async function searchCustomers(
  em: EntityManager,
  container: ContainerLike,
  scope: ChatScope,
  query: string,
  kinds: ReadonlySet<CustomerKind>,
): Promise<CustomerSummary[]> {
  const entity = customerEntity(container)
  const needle = query.trim()
  if (!entity || kinds.size === 0 || needle.length === 0) return []

  // Names are encrypted where encryption is on, so the plain match covers the
  // rest and the search index answers for the encrypted ones.
  const conditions: FilterQuery<CustomerRecord>[] = [
    { displayName: { $ilike: `%${needle.replace(/[%_\\]/g, '\\$&')}%` } },
  ]
  const indexed = await findEntityIdsBySearchTokens({
    db: em.getKysely<SearchTokenDatabase>(),
    entityType: CUSTOMER_ENTITY_TYPE,
    query: needle,
    fields: ['display_name'],
    scope: { tenantId: scope.tenantId, organizationId: scope.organizationId },
  })
  if (indexed.matched && indexed.ids.length > 0) conditions.push({ id: { $in: indexed.ids.slice(0, 500) } })
  const digits = extractPhoneDigits(needle)
  if (digits.length >= MIN_PHONE_DIGITS) {
    conditions.push({ primaryPhoneHash: { $in: lookupHashCandidates(digits, PHONE_HASH_CONTEXT) } })
  }

  const rows = await findWithDecryption(
    em,
    entity,
    { ...liveInScope(scope), kind: { $in: [...kinds] }, $or: conditions } as FilterQuery<CustomerRecord>,
    { limit: SEARCH_LIMIT, orderBy: { updatedAt: 'desc' } },
    scope,
  )
  return rows.map(summarize).filter((summary): summary is CustomerSummary => summary !== null)
}

/** What this viewer may see of a record: all of it, or only that there is one. */
export function customerRef(
  id: string,
  summary: CustomerSummary | undefined,
  kinds: ReadonlySet<CustomerKind>,
): ChatCustomerRefDto {
  if (!summary || !kinds.has(summary.kind)) return { id, kind: null, name: null, href: null }
  return { id, kind: summary.kind, name: summary.name, href: customerHref(summary.kind, summary.id) }
}

/**
 * A client conversation's outsiders with their CRM side: the linked record as
 * far as the viewer may see it, and — while unlinked — the CRM person with
 * their number. Without a CRM the list is returned as it came.
 */
export async function withCrm(
  em: EntityManager,
  container: ContainerLike,
  scope: ChatScope,
  viewer: { userId: string; access: ChatParticipantAccess | null; external: boolean },
  list: ChatMemberListDto,
): Promise<ChatMemberListDto> {
  if (!crmAvailable(container)) return { ...list, crm: { available: false, canLink: false } }
  const kinds = await viewableCustomerKinds(container, viewer.userId, scope)
  const canLink = viewer.external && kinds.size > 0 && hasAccess({ access: viewer.access }, 'participant')
  if (list.externalMembers.length === 0) return { ...list, crm: { available: true, canLink } }

  const linked = await loadCustomers(
    em,
    container,
    scope,
    list.externalMembers.flatMap((member) => (member.customer ? [member.customer.id] : [])),
  )
  const suggestions = kinds.has('person')
    ? await customersByPhone(
        em,
        container,
        scope,
        list.externalMembers.flatMap((member) => (!member.customer && member.handle ? [member.handle] : [])),
      )
    : new Map<string, CustomerSummary>()

  return {
    ...list,
    crm: { available: true, canLink },
    externalMembers: list.externalMembers.map((member) => {
      const suggested = !member.customer && member.handle ? suggestions.get(member.handle) : undefined
      return {
        ...member,
        customer: member.customer ? customerRef(member.customer.id, linked.get(member.customer.id), kinds) : null,
        suggestion: suggested ? customerRef(suggested.id, suggested, kinds) : null,
      }
    }),
  }
}
