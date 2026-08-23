import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { getCurrentCacheTenant, runWithCacheTenant } from '@open-mercato/cache'
import { getOwningModuleId } from '@open-mercato/shared/security/enabledModulesRegistry'
import { isEntitleableModule, listEntitleableModules } from '@open-mercato/core/modules/directory/lib/tenantModules'
import { User, UserModule } from '@open-mercato/core/modules/auth/data/entities'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('auth').child({ component: 'user-modules' })

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type UserModuleState = {
  moduleId: string
  title: string
  description: string | null
  isEnabled: boolean
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/**
 * Per-user module restriction — the second entitlement layer, sitting between
 * the tenant's entitlement and the RBAC grant check.
 *
 * The table stores **withheld** modules only: a row means "this user may not
 * reach this module", and the resolver subtracts those ids from the set the
 * tenant is entitled to. Subtraction is what makes the hierarchy safe by
 * construction — no write to `user_modules`, including a hand-crafted one, can
 * hand a user a module the Super Admin withheld from the tenant, because the
 * user layer never contributes ids to the result.
 *
 * It also means a missing, empty or unreadable restriction set degrades to
 * "tenant-level gating only" rather than to open access: reaching a module
 * still requires an enabled `tenant_modules` row and a matching RBAC grant,
 * both of which are independently fail-closed.
 */
export class UserModuleService {
  private cacheTtlMs: number = 5 * 60 * 1000
  private cache: CacheStrategy | null = null

  constructor(private em: EntityManager, cache?: CacheStrategy) {
    this.cache = cache || null
  }

  setCacheTtl(ttlMs: number) {
    this.cacheTtlMs = ttlMs
  }

  private getCacheKey(userId: string, tenantId: string | null | undefined): string {
    return `user-modules:${tenantId || 'null'}:${userId}`
  }

  static userTag(userId: string): string {
    return `user-modules:user:${userId}`
  }

  /**
   * API keys authenticate as `api_key:<id>` rather than as a user row, so they
   * carry no per-user restrictions. Anything that is not a bare uuid is likewise
   * not addressable in `user_modules` and must not reach the query — an invalid
   * uuid comparison would throw and turn a restriction lookup into a 500.
   */
  private isRestrictableSubject(userId: string | null | undefined): userId is string {
    return typeof userId === 'string' && UUID_PATTERN.test(userId)
  }

  /**
   * Module ids withheld from this user.
   *
   * Deliberately not filtered by tenant: a restriction row whose `tenant_id`
   * drifted (a user moved between tenants, a legacy null) must keep applying.
   * Reading restrictions too widely narrows access; reading them too narrowly
   * would widen it.
   */
  async getRestrictedModuleIds(userId: string | null | undefined, tenantId: string | null | undefined): Promise<string[]> {
    if (!this.isRestrictableSubject(userId)) return []
    const cacheKey = this.getCacheKey(userId, tenantId)
    if (this.cache) {
      const cached = await this.cache.get(cacheKey)
      if (isStringArray(cached)) return cached
    }
    const em = this.em.fork()
    const rows = await em.find(UserModule, { user: userId, isEnabled: false, deletedAt: null } as never, {})
    const restricted = Array.from(new Set(
      (Array.isArray(rows) ? rows : [])
        .map((row) => row.moduleId)
        .filter((moduleId): moduleId is string => typeof moduleId === 'string' && moduleId.length > 0)
        .filter(isEntitleableModule),
    ))
    if (this.cache) {
      await this.cache.set(cacheKey, restricted, {
        ttl: this.cacheTtlMs,
        tags: [UserModuleService.userTag(userId), 'user-modules:all'],
      })
    }
    return restricted
  }

  /** True when the user may reach the module, given they are not restricted from it. */
  async isModuleAllowed(userId: string | null | undefined, tenantId: string | null | undefined, moduleId: string): Promise<boolean> {
    if (!isEntitleableModule(moduleId)) return true
    const restricted = await this.getRestrictedModuleIds(userId, tenantId)
    return !restricted.includes(moduleId)
  }

  /** Removes module ids the user is restricted from. Never adds. */
  async filterModuleIds(
    userId: string | null | undefined,
    tenantId: string | null | undefined,
    moduleIds: readonly string[],
  ): Promise<string[]> {
    if (!moduleIds.length) return []
    const restricted = new Set(await this.getRestrictedModuleIds(userId, tenantId))
    if (!restricted.size) return [...moduleIds]
    return moduleIds.filter((moduleId) => !restricted.has(moduleId))
  }

  /**
   * Removes grants whose owning module the user is restricted from. Mirrors
   * `TenantModuleService.filterGrantsByEntitlement` so both layers narrow a
   * grant list the same way, wildcards included.
   */
  async filterGrantsByRestrictions(
    userId: string | null | undefined,
    tenantId: string | null | undefined,
    granted: readonly string[],
  ): Promise<string[]> {
    if (!granted.length) return []
    const restricted = new Set(await this.getRestrictedModuleIds(userId, tenantId))
    if (!restricted.size) return [...granted]
    return granted.filter((grant) => {
      if (grant === '*') return true
      const owningModule = getOwningModuleId(grant)
      if (!isEntitleableModule(owningModule)) return true
      return !restricted.has(owningModule)
    })
  }

  /**
   * The assignable surface for a tenant admin: one row per module the *tenant*
   * is entitled to, with whether this user may currently reach it. A module the
   * tenant does not have never appears, so it cannot be offered as an option.
   */
  async listUserModules(
    userId: string,
    tenantId: string | null | undefined,
    tenantEnabledModuleIds: readonly string[],
  ): Promise<UserModuleState[]> {
    const restricted = new Set(await this.getRestrictedModuleIds(userId, tenantId))
    const available = new Set(tenantEnabledModuleIds.filter(isEntitleableModule))
    // Registry order, so the list reads the same as the tenant-level screen.
    return listEntitleableModules()
      .filter((mod) => available.has(mod.moduleId))
      .map((mod) => ({
        moduleId: mod.moduleId,
        title: mod.title,
        description: mod.description,
        isEnabled: !restricted.has(mod.moduleId),
      }))
  }

  /**
   * The cache is partitioned per cache-tenant context, so a write made while a
   * different context is active would leave a stale entry behind. Mirrors
   * `TenantModuleService.invalidate` and sweeps the current context, the global
   * one, and the tenant being changed.
   */
  private async invalidate(userId: string, tenantId: string | null | undefined): Promise<void> {
    if (!this.cache) return
    const current = getCurrentCacheTenant()
    const contexts = new Set<string | null>([current ?? null, null, tenantId ?? null])
    // Also drop this user's cached navigation payload. It is stored under its own
    // 30-minute TTL, so without this a withheld module keeps its sidebar entries
    // until the TTL lapses — the route guard denies, but the user sees links that
    // lead nowhere. Same tags `RbacService` and the nav route already publish.
    const tags = [
      UserModuleService.userTag(userId),
      `rbac:user:${userId}`,
      `nav:sidebar:user:${userId}`,
    ]
    for (const ctx of contexts) {
      if (ctx === current) {
        await this.cache.deleteByTags(tags)
      } else {
        await runWithCacheTenant(ctx, async () => {
          await this.cache!.deleteByTags(tags)
        })
      }
    }
  }

  /**
   * Idempotently records whether a user may reach one module.
   *
   * `isEnabled: true` clears the restriction rather than granting anything —
   * the effective set is still whatever the tenant is entitled to. Callers must
   * have already established that `moduleId` is one the tenant holds; this
   * method refuses platform modules outright because gating `auth` or
   * `directory` would lock the user out of being administered at all.
   */
  async setModuleEnabled(
    userId: string,
    tenantId: string | null | undefined,
    moduleId: string,
    isEnabled: boolean,
  ): Promise<void> {
    if (!isEntitleableModule(moduleId)) {
      throw new Error(`[internal] ${moduleId} is a platform module and cannot be restricted per user`)
    }
    const em = this.em.fork()
    const user = await em.findOne(User, { id: userId, deletedAt: null })
    if (!user) throw new Error(`[internal] user ${userId} not found`)
    const existing = await em.findOne(UserModule, { user: userId, moduleId } as never)
    if (existing) {
      if (existing.isEnabled !== isEnabled || existing.deletedAt || existing.tenantId !== (tenantId ?? null)) {
        existing.isEnabled = isEnabled
        existing.tenantId = tenantId ?? null
        existing.deletedAt = null
        await em.persist(existing).flush()
      }
    } else if (!isEnabled) {
      // Only a withheld module needs a row; "allowed" is the absence of one.
      em.persist(em.create(UserModule, {
        user,
        tenantId: tenantId ?? null,
        moduleId,
        isEnabled,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
      await em.flush()
    }
    await this.invalidate(userId, tenantId)
    logger.debug('Updated user module restriction', { userId, tenantId: tenantId ?? null, moduleId, isEnabled })
  }
}
