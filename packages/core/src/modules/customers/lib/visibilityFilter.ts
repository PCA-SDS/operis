import type { FilterQuery } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { CustomerInteraction } from '../data/entities'

/**
 * The ACL feature that grants admins the right to see private emails authored
 * by other users. Declared in `acl.ts` but granted to NO role in v1 (reserved
 * for the v2 oversight feature — see `callerHasEmailViewPrivate`).
 */
export const EMAIL_VIEW_PRIVATE_FEATURE = 'customers.email.view_private'

/**
 * Returns true when the caller holds the admin override to see ALL private email
 * interactions. Honours wildcards (`customers.*`, `*`).
 *
 * RESERVED FOR v2 — NOT wired in v1. The v1 model is strict owner-only with no
 * admin bypass: the visibility filters and `canChangeEmailVisibility` ignore
 * caller features, and `customers.email.view_private` is granted to no role.
 * Kept (with {@link EMAIL_VIEW_PRIVATE_FEATURE}) so v2 oversight can opt back in
 * without re-introducing the helper. Do NOT wire this into a read path without
 * an explicit v2 spec.
 */
export function callerHasEmailViewPrivate(userFeatures: string[] | null | undefined): boolean {
  if (!Array.isArray(userFeatures) || userFeatures.length === 0) return false
  return authorizeFeatures([EMAIL_VIEW_PRIVATE_FEATURE], {
    grantedFeatures: userFeatures,
  })
}

/**
 * Authorization predicate for CHANGING an email interaction's visibility.
 *
 * Personal mailbox privacy (v1: strict owner-only): ONLY the interaction's
 * author may flip their own email between private/shared — there is no admin
 * bypass. Non-email rows and no-op changes are always allowed. Mirrors the gate
 * in the dedicated `PATCH .../visibility` route so the generic interaction-update
 * path cannot bypass the privacy control. `userFeatures` is reserved for v2.
 */
export function canChangeEmailVisibility(opts: {
  interactionType: string
  currentVisibility: string | null | undefined
  nextVisibility: string | null | undefined
  authorUserId: string | null | undefined
  actorUserId: string | null | undefined
  userFeatures: string[] | null | undefined
}): boolean {
  if (opts.interactionType !== 'email') return true
  if ((opts.nextVisibility ?? null) === (opts.currentVisibility ?? null)) return true
  return Boolean(opts.actorUserId) && opts.authorUserId === opts.actorUserId
}

export interface ApplyEmailVisibilityFilterOptions {
  currentUserId: string | null
  userFeatures: string[] | null | undefined
}

/**
 * Adds a `WHERE` predicate to a kysely query so that:
 *   - Non-email interactions (calls, meetings, tasks) pass through unchanged.
 *   - Email interactions with `visibility = 'shared'` are visible to all.
 *   - Email interactions with `visibility = 'private'` are visible ONLY to the
 *     `authorUserId` (channel owner).
 *
 * Personal mailbox privacy (v1: strict owner-only) — there is NO admin bypass:
 * a private email is hidden from everyone except its author, including
 * admins/superadmins. `opts.userFeatures` is retained for signature stability
 * and reserved for the v2 admin-oversight feature.
 *
 * The function expects a kysely-style builder whose `.where()` accepts an
 * expression-builder callback. Returns the same builder for chaining.
 */
export function applyEmailVisibilityFilter<T extends { where: (...args: any[]) => T }>(
  query: T,
  opts: ApplyEmailVisibilityFilterOptions,
): T {
  const currentUserId = opts.currentUserId
  // A row is hidden ONLY when it is an email explicitly marked `private` and the
  // caller is not its author. Everything else stays visible, including:
  //   - non-email interactions (calls, meetings, tasks),
  //   - emails marked `shared`,
  //   - legacy/unset rows where `visibility IS NULL` (e.g. email-log entries
  //     created before per-email visibility shipped) — these must remain
  //     visible to avoid silently hiding pre-existing CRM history.
  return query.where((eb: any) =>
    eb.or([
      eb('interaction_type', '!=', 'email'),
      eb('visibility', 'is', null),
      eb('visibility', '!=', 'private'),
      currentUserId
        ? eb('author_user_id', '=', currentUserId)
        : eb.val(false),
    ]),
  )
}

type RbacFeatureLookup = (
  userId: string,
  scope: { tenantId: string | null; organizationId: string | null },
) => Promise<string[] | undefined>

type RbacServiceLike = {
  getEffectiveFeatures?: RbacFeatureLookup
  getGrantedFeatures?: RbacFeatureLookup
}

/**
 * Resolve the caller's granted features (wildcard-aware downstream) so a v2
 * visibility filter could honour the `customers.email.view_private` admin
 * override. Returns `undefined` when there is no user or the RBAC service is
 * unavailable — callers MUST treat `undefined` as "no bypass" (fail closed).
 *
 * RESERVED FOR v2 — NOT called by any v1 read path. v1 is strict owner-only, so
 * the read routes pass `userFeatures: undefined` to the filters rather than
 * resolving features here (which would be a wasted RBAC round-trip). Re-wire
 * only under an explicit v2 oversight spec.
 */
export async function resolveCallerEmailFeatures(
  container: { resolve: (name: string) => unknown },
  userId: string | null,
  tenantId: string | null,
  organizationId: string | null,
): Promise<string[] | undefined> {
  if (!userId) return undefined
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.getEffectiveFeatures) return undefined
    return await rbac.getEffectiveFeatures(userId, { tenantId, organizationId })
  } catch {
    return undefined
  }
}

/**
 * MikroORM equivalent of {@link applyEmailVisibilityFilter}. Returns a
 * `FilterQuery` fragment to merge (implicit AND) into a `CustomerInteraction`
 * where-clause so private email rows are excluded for non-owner, non-admin
 * callers on MikroORM read paths (`findWithDecryption`/`em.find`/`em.count`).
 *
 * Mirrors the kysely predicate exactly, including the legacy `visibility IS NULL`
 * passthrough so pre-existing CRM history is never hidden. Personal mailbox
 * privacy (v1: strict owner-only): no admin bypass — a private email is hidden
 * from everyone except its author. `opts.userFeatures` is reserved for v2.
 */
export type EmailVisibilityMikroFilter = { $or?: FilterQuery<CustomerInteraction>[] }

export function buildEmailVisibilityMikroFilter(
  opts: ApplyEmailVisibilityFilterOptions,
): EmailVisibilityMikroFilter {
  return {
    $or: [
      { interactionType: { $ne: 'email' } },
      { visibility: null },
      { visibility: { $ne: 'private' } },
      ...(opts.currentUserId ? [{ authorUserId: opts.currentUserId }] : []),
    ],
  }
}

/**
 * The ACL feature that lets a user read interactions they are not involved in.
 * Without it, a personal view (the calendar) shows only rows the viewer authored,
 * owns, or is a participant of.
 */
export const INTERACTIONS_VIEW_ALL_FEATURE = 'customers.interactions.view_all'

/**
 * Whether the caller may read interactions beyond their own involvement.
 *
 * Goes through `authorizeFeatures` rather than a raw string match so a wildcard
 * grant (`customers.*`, `*`) satisfies it, and so a feature that has been
 * removed, disabled, or belongs to a disabled module denies rather than grants.
 */
export function canViewAllInteractions(userFeatures: string[] | null | undefined): boolean {
  if (!Array.isArray(userFeatures) || userFeatures.length === 0) return false
  return authorizeFeatures([INTERACTIONS_VIEW_ALL_FEATURE], { grantedFeatures: userFeatures })
}

export interface PersonalScopeOptions {
  /** The asking user, or null for an API key (no personal view to protect). */
  viewerUserId: string | null
  /** Result of {@link canViewAllInteractions} for that user. */
  canViewAll: boolean
  /**
   * True when the request names a customer or deal, i.e. asks for one record's
   * history rather than for a personal view.
   */
  customerScoped: boolean
}

/**
 * Restricts a kysely query over `customer_interactions` to rows the viewer is
 * involved in: author, owner, or a listed participant.
 *
 * Involvement — not authorship alone — is the test, so being invited to a
 * meeting or assigned a task is what makes it visible, which is the rule a team
 * calendar is expected to follow.
 *
 * Three cases pass through unfiltered:
 *   - `customerScoped`: a CRM timeline is shared by definition. Reading Acme's
 *     history already requires access to Acme, and the timeline exists so the
 *     team can see who last spoke to them.
 *   - `canViewAll`: the caller holds the oversight feature.
 *   - no `viewerUserId`: an API key is not a person and owns no rows, so
 *     scoping it to what it "authored" would match nothing and would break
 *     integrations that legitimately read a whole window. It stays bounded by
 *     tenant, organization and the features issued to that key.
 *
 * `participants` is a jsonb array of `{ userId, ... }`, so containment is the
 * membership test and it can use the column's GIN index instead of unnesting
 * every row.
 */
export function applyPersonalScopeFilter<T extends { where: (...args: any[]) => T }>(
  query: T,
  opts: PersonalScopeOptions,
): T {
  const viewerUserId = opts.viewerUserId
  if (!viewerUserId || opts.canViewAll || opts.customerScoped) return query
  return query.where((eb: any) =>
    eb.or([
      eb('author_user_id', '=', viewerUserId),
      eb('owner_user_id', '=', viewerUserId),
      eb(sql`participants`, '@>', sql`${JSON.stringify([{ userId: viewerUserId }])}::jsonb`),
    ]),
  )
}

/**
 * The caller's granted features, including wildcards, or `undefined` when they
 * cannot be resolved.
 *
 * Distinct from {@link resolveCallerEmailFeatures}, which reads *effective*
 * features (wildcards already expanded to concrete ids). Authorization decisions
 * want the granted list so `customers.*` keeps matching through
 * {@link canViewAllInteractions}. Failures resolve to `undefined`, which every
 * caller treats as "no grants" — fail-closed.
 */
export async function resolveGrantedFeatures(
  container: { resolve: (name: string) => unknown },
  userId: string,
  tenantId: string | null,
  organizationId: string | null,
): Promise<string[] | undefined> {
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.getGrantedFeatures) return undefined
    return await rbac.getGrantedFeatures(userId, { tenantId, organizationId })
  } catch {
    return undefined
  }
}
