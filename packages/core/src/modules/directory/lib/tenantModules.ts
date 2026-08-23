import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { getCurrentCacheTenant, runWithCacheTenant } from '@open-mercato/cache'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { getOwningModuleId, hasEnabledModulesRegistry } from '@open-mercato/shared/security/enabledModulesRegistry'
import { TenantModule, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('directory').child({ component: 'tenant-modules' })

/**
 * Modules that are part of the platform itself rather than something a tenant
 * subscribes to. They are never written to `tenant_modules` and never gated —
 * entitlement is about which business capabilities a tenant bought, and gating
 * `auth` or `directory` would revoke a tenant's ability to log in and be
 * administered at all.
 */
export const PLATFORM_MODULE_IDS: readonly string[] = [
  'core',
  'auth',
  'directory',
  'configs',
  'entities',
  'query_index',
  'widgets',
  'dashboards',
  'translations',
  'notifications',
  'attachments',
  'audit_logs',
  'api_docs',
  'api_keys',
  'dictionaries',
  'feature_toggles',
  'perspectives',
  'progress',
  'design_system',
  'search',
  'scheduler',
  'telemetry',
  'events',
  'queue',
  'cache',
] as const

const PLATFORM_MODULE_SET = new Set(PLATFORM_MODULE_IDS)

/** True when the module is a tenant-facing capability that entitlement governs. */
export function isEntitleableModule(moduleId: string): boolean {
  return !!moduleId && !PLATFORM_MODULE_SET.has(moduleId)
}

/**
 * Whether entitlement can be evaluated at all.
 *
 * Owning-module resolution needs the bootstrapped module registry; without it
 * `getOwningModuleId` degrades to the feature's dotted prefix, which is not
 * reliably a module id (`users.view` is owned by `auth`). Deciding access on
 * that guess would deny real grants in every context that does not bootstrap
 * the full registry — route unit tests, CLI subcommands, partial bootstraps.
 * So entitlement stands down there, exactly as `filterGrantsByEnabledModules`
 * already does for the deploy-level module filter.
 */
export function isEntitlementEnforceable(): boolean {
  return hasEnabledModulesRegistry()
}

/** Every registered module id that entitlement governs, in registry order. */
export function listEntitleableModuleIds(): string[] {
  let moduleIds: string[] = []
  try {
    moduleIds = (getModules() as ReadonlyArray<{ id: string }>).map((mod) => mod.id)
  } catch {
    return []
  }
  return moduleIds.filter(isEntitleableModule)
}

export type TenantModuleState = {
  moduleId: string
  isEnabled: boolean
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/**
 * Resolves per-tenant module entitlement.
 *
 * Entitlement is deliberately fail-closed: an entitleable module is reachable
 * only when the tenant has a `tenant_modules` row with `is_enabled = true`. A
 * missing row denies, so shipping a new module never silently exposes it to
 * every existing tenant. `provisionTenant` is what turns modules on, and it
 * runs from `onTenantCreated` plus the `directory sync-tenant-modules` CLI.
 */
export class TenantModuleService {
  private cacheTtlMs: number = 5 * 60 * 1000
  private cache: CacheStrategy | null = null

  constructor(private em: EntityManager, cache?: CacheStrategy) {
    this.cache = cache || null
  }

  setCacheTtl(ttlMs: number) {
    this.cacheTtlMs = ttlMs
  }

  private getCacheKey(tenantId: string): string {
    return `tenant-modules:${tenantId}`
  }

  static tenantTag(tenantId: string): string {
    return `tenant-modules:tenant:${tenantId}`
  }

  /** Enabled entitleable module ids for the tenant. Empty when nothing is granted. */
  async getEnabledModuleIds(tenantId: string | null | undefined): Promise<string[]> {
    if (!tenantId) return []
    const cacheKey = this.getCacheKey(tenantId)
    if (this.cache) {
      const cached = await this.cache.get(cacheKey)
      if (isStringArray(cached)) return cached
    }
    const em = this.em.fork()
    const rows = await em.find(TenantModule, { tenant: tenantId, isEnabled: true, deletedAt: null } as never, {})
    const enabled = Array.from(new Set(
      (Array.isArray(rows) ? rows : [])
        .map((row) => row.moduleId)
        .filter((moduleId): moduleId is string => typeof moduleId === 'string' && moduleId.length > 0),
    ))
    if (this.cache) {
      await this.cache.set(cacheKey, enabled, {
        ttl: this.cacheTtlMs,
        tags: [TenantModuleService.tenantTag(tenantId), 'tenant-modules:all'],
      })
    }
    return enabled
  }

  /** Platform modules always resolve true; entitleable modules need a row. */
  async isModuleEnabled(tenantId: string | null | undefined, moduleId: string): Promise<boolean> {
    if (!isEntitleableModule(moduleId)) return true
    if (!tenantId) return false
    const enabled = await this.getEnabledModuleIds(tenantId)
    return enabled.includes(moduleId)
  }

  /**
   * Drops grants whose owning module the tenant is not entitled to. Wildcards
   * are resolved through the same owning-module lookup the deploy-level filter
   * uses, so `customers.*` disappears with the `customers` entitlement while
   * `*` is expanded by the caller before it reaches here.
   */
  async filterGrantsByEntitlement(
    tenantId: string | null | undefined,
    granted: readonly string[],
  ): Promise<string[]> {
    if (!granted.length) return []
    const enabled = new Set(await this.getEnabledModuleIds(tenantId))
    return granted.filter((grant) => {
      if (grant === '*') return true
      const owningModule = getOwningModuleId(grant)
      if (!isEntitleableModule(owningModule)) return true
      return enabled.has(owningModule)
    })
  }

  /** Expands a superadmin `*` grant into one wildcard per module the tenant may reach. */
  async expandUnrestrictedGrants(tenantId: string | null | undefined): Promise<string[]> {
    const enabled = await this.getEnabledModuleIds(tenantId)
    return [
      ...PLATFORM_MODULE_IDS.map((moduleId) => `${moduleId}.*`),
      ...enabled.map((moduleId) => `${moduleId}.*`),
    ]
  }

  async listTenantModules(tenantId: string): Promise<TenantModuleState[]> {
    const em = this.em.fork()
    const rows = await em.find(TenantModule, { tenant: tenantId, deletedAt: null } as never, {})
    const byModuleId = new Map<string, boolean>()
    for (const row of Array.isArray(rows) ? rows : []) {
      byModuleId.set(row.moduleId, !!row.isEnabled)
    }
    return listEntitleableModuleIds().map((moduleId) => ({
      moduleId,
      isEnabled: byModuleId.get(moduleId) ?? false,
    }))
  }

  /**
   * The cache is partitioned per cache-tenant context, so a write made while a
   * different context is active would leave a stale entry behind. Mirror
   * `RbacService.deleteCacheByTags` and sweep the current context, the global
   * one, and the tenant being changed.
   */
  private async invalidate(tenantId: string): Promise<void> {
    if (!this.cache) return
    const current = getCurrentCacheTenant()
    const contexts = new Set<string | null>([current ?? null, null, tenantId])
    const tags = [TenantModuleService.tenantTag(tenantId)]
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

  /** Idempotently sets one module's entitlement for a tenant. */
  async setModuleEnabled(tenantId: string, moduleId: string, isEnabled: boolean): Promise<void> {
    if (!isEntitleableModule(moduleId)) {
      throw new Error(`[internal] ${moduleId} is a platform module and cannot be entitled per tenant`)
    }
    const em = this.em.fork()
    const existing = await em.findOne(TenantModule, { tenant: tenantId, moduleId } as never)
    if (existing) {
      if (existing.isEnabled !== isEnabled || existing.deletedAt) {
        existing.isEnabled = isEnabled
        existing.deletedAt = null
        await em.persist(existing).flush()
      }
    } else {
      const tenant = await em.findOne(Tenant, { id: tenantId })
      if (!tenant) throw new Error(`[internal] tenant ${tenantId} not found`)
      em.persist(em.create(TenantModule, { tenant, moduleId, isEnabled, createdAt: new Date(), updatedAt: new Date() }))
      await em.flush()
    }
    await this.invalidate(tenantId)
  }

  /**
   * Ensures a row exists for every entitleable module. Idempotent: existing
   * rows keep whatever entitlement an operator already chose, so re-running it
   * after adding a module grants only the newly discovered ones.
   */
  async provisionTenant(
    tenantId: string,
    options: { enabledByDefault?: boolean; only?: readonly string[] } = {},
  ): Promise<{ created: string[]; existing: string[] }> {
    const enabledByDefault = options.enabledByDefault ?? true
    const candidates = options.only
      ? options.only.filter(isEntitleableModule)
      : listEntitleableModuleIds()
    if (!candidates.length) return { created: [], existing: [] }

    const em = this.em.fork()
    const tenant = await em.findOne(Tenant, { id: tenantId })
    if (!tenant) throw new Error(`[internal] tenant ${tenantId} not found`)

    const rows = await em.find(TenantModule, { tenant: tenantId } as never, {})
    const known = new Set((Array.isArray(rows) ? rows : []).map((row) => row.moduleId))
    const created: string[] = []
    const existing: string[] = []
    for (const moduleId of candidates) {
      if (known.has(moduleId)) {
        existing.push(moduleId)
        continue
      }
      em.persist(em.create(TenantModule, {
        tenant,
        moduleId,
        isEnabled: enabledByDefault,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
      created.push(moduleId)
    }
    if (created.length) await em.flush()
    await this.invalidate(tenantId)
    if (created.length) {
      logger.info('Provisioned tenant modules', { tenantId, created: created.length, enabledByDefault })
    }
    return { created, existing }
  }
}
