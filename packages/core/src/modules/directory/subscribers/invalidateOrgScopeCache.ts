// Invalidate the OrganizationScope cache when an organization mutates.
//
// resolveOrganizationScopeForRequest caches its result with a short TTL
// (default 60s, OM_ORG_SCOPE_CACHE_TTL_MS). When an organization is
// created/updated/deleted, the cached scope for users of the affected
// tenant may be stale (visibility set or descendant tree changed). We
// drop every cache entry tagged for that tenant; the TTL is the backstop
// for races where the event fires after a request reads the cache.

import { buildOrgScopeTenantCacheTag } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { runWithCacheTenant } from '@open-mercato/cache'

type CacheService = {
  deleteByTags(tags: string[]): Promise<number>
}

export const metadata = {
  event: 'directory.organization.*',
  persistent: false,
  id: 'directory:invalidate-org-scope-cache',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const data = (payload ?? {}) as Record<string, unknown>
  const tenantId = typeof data.tenantId === 'string' ? data.tenantId : null
  if (!tenantId) return
  let cache: CacheService | null = null
  try {
    cache = ctx.resolve<CacheService>('cache')
  } catch {
    return
  }
  if (!cache) return
  // Drop under BOTH the tenant scope and the global (null) scope.
  //
  // The cache service prefixes every key and tag with the ambient cache tenant
  // from AsyncLocalStorage. Only the API dispatcher establishes one
  // (`runWithCacheTenant` in apps/mercato/src/app/api/[...slug]/route.ts); the
  // two SERVER-COMPONENT callers of resolveOrganizationScopeForRequest — the
  // backend catch-all page and the sidebar chrome — run with no ambient tenant,
  // so their entries land under `tenant:global:`. Dropping only the tenant scope
  // left those stale for the full TTL, including the `allowedOrganizationIds`
  // that gates the page-level access check. `RbacService.deleteCacheByTags`
  // already sweeps both scopes; this mirrors it.
  const tag = buildOrgScopeTenantCacheTag(tenantId)
  for (const scope of [tenantId, null] as Array<string | null>) {
    try {
      await runWithCacheTenant(scope, () => cache.deleteByTags([tag]))
    } catch {
      // best-effort; TTL is the backstop.
    }
  }
}
