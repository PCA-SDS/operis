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

type RegistryModule = {
  id: string
  info?: { title?: string; description?: string; requires?: string[] }
}

function readRegistry(): ReadonlyArray<RegistryModule> {
  try {
    return getModules() as ReadonlyArray<RegistryModule>
  } catch {
    return []
  }
}

/** Every registered module id that entitlement governs, in registry order. */
export function listEntitleableModuleIds(): string[] {
  return readRegistry().map((mod) => mod.id).filter(isEntitleableModule)
}

export type EntitleableModule = {
  moduleId: string
  title: string
  description: string | null
  /** Entitleable modules this one hard-depends on (`info.requires`, platform deps dropped). */
  requires: string[]
}

/**
 * The entitlement catalog: one entry per governed module with the display
 * metadata the management screens need, plus its hard dependencies.
 *
 * Platform ids are stripped from `requires` because they are never gated — a
 * module requiring `auth` places no constraint an operator can violate, and
 * listing it would only invite an unsatisfiable prerequisite in the UI.
 */
export function listEntitleableModules(): EntitleableModule[] {
  return readRegistry()
    .filter((mod) => isEntitleableModule(mod.id))
    .map((mod) => ({
      moduleId: mod.id,
      title: typeof mod.info?.title === 'string' && mod.info.title.length ? mod.info.title : mod.id,
      description: typeof mod.info?.description === 'string' && mod.info.description.length
        ? mod.info.description
        : null,
      requires: Array.isArray(mod.info?.requires)
        ? Array.from(new Set(mod.info!.requires.filter((dep): dep is string => typeof dep === 'string' && isEntitleableModule(dep))))
        : [],
    }))
}

/** moduleId → its entitleable hard dependencies. */
export function buildModuleDependencyGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>()
  for (const mod of listEntitleableModules()) graph.set(mod.moduleId, mod.requires)
  return graph
}

/**
 * Resolves stored entitlement into *reachable* entitlement.
 *
 * `info.requires` declares a hard dependency — `wms` cannot function without
 * `catalog` and `sales`, `staff` cannot without `planner` and `resources`. If
 * entitlement honoured only the stored row, an operator could leave a tenant in
 * exactly the invalid state the hierarchy is supposed to make unrepresentable:
 * a dependent module switched on while its prerequisite is switched off, whose
 * pages then load and fail on data that is not there.
 *
 * Fixed-point removal, so a transitive chain collapses in one pass
 * (`planner` off ⇒ `resources` off ⇒ `staff` off). A dependency cycle is left
 * intact when every member is enabled — removal is driven by an *absent*
 * dependency, so mutually-requiring modules never delete each other.
 */
export function resolveReachableModuleIds(
  storedEnabled: readonly string[],
  graph: Map<string, string[]> = buildModuleDependencyGraph(),
): string[] {
  const reachable = new Set(storedEnabled)
  let changed = true
  while (changed) {
    changed = false
    for (const moduleId of Array.from(reachable)) {
      const requires = graph.get(moduleId)
      if (!requires || requires.length === 0) continue
      if (requires.some((dep) => !reachable.has(dep))) {
        reachable.delete(moduleId)
        changed = true
      }
    }
  }
  return Array.from(reachable)
}

export type TenantModuleState = {
  moduleId: string
  title: string
  description: string | null
  isEnabled: boolean
  /** Hard dependencies the operator has not enabled — the module stays unreachable until they are. */
  missingDependencies: string[]
  /** Enabled modules that would become unreachable if this one were switched off. */
  dependents: string[]
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

  /** Raw stored entitlement, before dependency resolution. Management screens read this. */
  private async getStoredEnabledModuleIds(tenantId: string): Promise<string[]> {
    const em = this.em.fork()
    const rows = await em.find(TenantModule, { tenant: tenantId, isEnabled: true, deletedAt: null } as never, {})
    return Array.from(new Set(
      (Array.isArray(rows) ? rows : [])
        .map((row) => row.moduleId)
        .filter((moduleId): moduleId is string => typeof moduleId === 'string' && moduleId.length > 0),
    ))
  }

  /**
   * Module ids the tenant can actually reach: stored entitlement narrowed to
   * the modules whose hard dependencies are also entitled. Every gate in the
   * app funnels through here, so a dependent module switched on above a
   * withheld prerequisite is unreachable everywhere at once rather than
   * half-working.
   */
  async getEnabledModuleIds(tenantId: string | null | undefined): Promise<string[]> {
    if (!tenantId) return []
    const cacheKey = this.getCacheKey(tenantId)
    if (this.cache) {
      const cached = await this.cache.get(cacheKey)
      if (isStringArray(cached)) return cached
    }
    const enabled = resolveReachableModuleIds(await this.getStoredEnabledModuleIds(tenantId))
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

  /**
   * The management view: every governed module with its *stored* state, plus the
   * dependency context an operator needs to act.
   *
   * Stored state — not reachable state — because the toggle must reflect what
   * the operator set. Showing the resolved value would make a switch silently
   * spring back when a prerequisite is missing; `missingDependencies` explains
   * that instead, and `dependents` warns what a switch-off would take with it.
   */
  async listTenantModules(tenantId: string): Promise<TenantModuleState[]> {
    const em = this.em.fork()
    const rows = await em.find(TenantModule, { tenant: tenantId, deletedAt: null } as never, {})
    const byModuleId = new Map<string, boolean>()
    for (const row of Array.isArray(rows) ? rows : []) {
      byModuleId.set(row.moduleId, !!row.isEnabled)
    }
    const catalog = listEntitleableModules()
    const storedEnabled = new Set(
      catalog.map((mod) => mod.moduleId).filter((moduleId) => byModuleId.get(moduleId) ?? false),
    )
    const dependentsOf = new Map<string, string[]>()
    for (const mod of catalog) {
      for (const dep of mod.requires) {
        if (!storedEnabled.has(mod.moduleId)) continue
        dependentsOf.set(dep, [...(dependentsOf.get(dep) ?? []), mod.moduleId])
      }
    }
    return catalog.map((mod) => ({
      moduleId: mod.moduleId,
      title: mod.title,
      description: mod.description,
      isEnabled: storedEnabled.has(mod.moduleId),
      missingDependencies: storedEnabled.has(mod.moduleId)
        ? mod.requires.filter((dep) => !storedEnabled.has(dep))
        : [],
      dependents: dependentsOf.get(mod.moduleId) ?? [],
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
    // Entitlement decides what the navigation payload contains, and that payload
    // is cached separately for 30 minutes under its own tags. Dropping only the
    // entitlement entry leaves every user in the tenant looking at a sidebar full
    // of links into a module the guards now deny — enforcement stays correct, but
    // the UI lies until the TTL expires. These are the tags `RbacService` and the
    // nav route already publish; no new vocabulary, just the missing sweep.
    const tags = [
      TenantModuleService.tenantTag(tenantId),
      `rbac:tenant:${tenantId}`,
      `nav:sidebar:tenant:${tenantId}`,
      `nav:entities:${tenantId}`,
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
