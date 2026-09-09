import type { AwilixContainer } from 'awilix'

type RbacServiceLike = {
  getGrantedFeatures: (
    userId: string,
    opts: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

type ContainerLike = Pick<AwilixContainer, 'resolve'>

export type GrantedFeaturesAuth = {
  sub?: string | null
  tenantId?: string | null
  orgId?: string | null
} | null | undefined

/**
 * The caller's granted ACL features, resolved from `rbacService`.
 *
 * This is the ONLY correct source. `AuthContext` has an open index signature, so
 * `auth.features` type-checks — but nothing on the JWT or API-key path ever sets
 * it, so reading it always yields `[]`. Twelve modules had independently
 * copy-pasted that mistake; a feature-gated mutation guard would silently never
 * match on any of their routes, because `runMutationGuards` filters guards by
 * `authorizeFeatures(guard.features, { grantedFeatures })`.
 *
 * Returns `[]` when RBAC is unavailable, which keeps guards that declare no
 * features running (`authorizeFeatures([], …)` is `true`) while feature-gated
 * ones stay inert rather than failing the request.
 */
export async function resolveGrantedFeatures(
  container: ContainerLike,
  auth: GrantedFeaturesAuth,
  organizationId?: string | null,
): Promise<string[]> {
  const userId = typeof auth?.sub === 'string' ? auth.sub : null
  if (!userId) return []
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.getGrantedFeatures) return []
    return await rbac.getGrantedFeatures(userId, {
      tenantId: auth?.tenantId ?? null,
      organizationId: organizationId ?? auth?.orgId ?? null,
    })
  } catch {
    // rbacService not registered (worker/CLI contexts) — guards without feature
    // requirements still run.
    return []
  }
}
