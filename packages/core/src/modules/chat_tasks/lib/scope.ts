import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'

/** The tenant + organization pair every read and write here is pinned to. */
export type ChatTasksScope = {
  tenantId: string
  organizationId: string
}

type FeatureChecker = {
  userHasAllFeatures(
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ): Promise<boolean>
}

/**
 * Whether this user holds these grants, asked of the RBAC service rather than of
 * a token claim.
 *
 * Every gate in this module goes through here, including ones a route has already
 * checked coarsely. The reason is the two-boundary rule the whole integration
 * rests on: chat access never implies task access and task access never implies
 * chat access, so "may read the conversation" and "may read the task" are two
 * questions and both have to be asked of the same authority. Route metadata can
 * only express the union; the per-record answer has to be asked per record.
 */
export async function callerHasFeatures(
  container: AwilixContainer,
  userId: string,
  scope: ChatTasksScope,
  features: readonly string[],
): Promise<boolean> {
  if (features.length === 0) return true
  const rbac = container.resolve('rbacService') as FeatureChecker
  return rbac.userHasAllFeatures(userId, [...features], {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
}

/**
 * Whether a module is switched on for this tenant.
 *
 * Entitlement is a separate axis from ACL: an administrator can hold `tasks.*`
 * in a tenant that does not have the tasks module at all, and this integration
 * must not become the surface that quietly re-enables it. Absent service, or a
 * service that cannot answer, is treated as "enabled" — the same fail-open the
 * platform's own entitlement helper takes when the registry is not bootstrapped,
 * because failing closed there would break every test harness that builds a
 * partial container.
 */
export async function moduleEnabledForTenant(
  container: AwilixContainer,
  tenantId: string,
  moduleId: string,
): Promise<boolean> {
  const resolver = container as AwilixContainer & { hasRegistration?: (name: string) => boolean }
  if (typeof resolver.hasRegistration === 'function' && !resolver.hasRegistration('tenantModuleService')) {
    return true
  }
  try {
    const service = container.resolve('tenantModuleService') as {
      isModuleEnabled?: (tenantId: string, moduleId: string) => Promise<boolean>
    }
    if (typeof service?.isModuleEnabled !== 'function') return true
    return await service.isModuleEnabled(tenantId, moduleId)
  } catch {
    return true
  }
}

/** A scoped `em.find` filter that never omits a scope dimension. */
export function scopedWhere(scope: ChatTasksScope, extra: Record<string, unknown> = {}) {
  return { tenantId: scope.tenantId, organizationId: scope.organizationId, ...extra }
}

/** Unused-parameter guard so the helper file has no accidental default export. */
export type ChatTasksEm = EntityManager
