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
  'dictionaries',
  'feature_toggles',
  'perspectives',
  'progress',
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
  info?: {
    title?: string
    description?: string
    requires?: string[]
    defaultEntitlement?: 'enabled' | 'disabled'
    category?: string
    sortOrder?: number
    aiAssistant?: boolean
  }
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
  /** Whether a newly provisioned tenant receives this module switched on. */
  defaultEntitlement: 'enabled' | 'disabled'
  /** Presentational grouping for the entitlement screens. */
  category: string
  /** Rank within the category; ties broken by title. */
  sortOrder: number
  /** Whether the module ships an in-app AI assistant the tenant can be given. */
  aiAssistantAvailable: boolean
}

/** Modules with no declared category fall here, rendered last. */
export const UNCATEGORISED_MODULE_GROUP = 'Other'

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
      defaultEntitlement: resolveDefaultEntitlement(mod),
      category: typeof mod.info?.category === 'string' && mod.info.category.length
        ? mod.info.category
        : UNCATEGORISED_MODULE_GROUP,
      sortOrder: Number.isFinite(mod.info?.sortOrder) ? Number(mod.info!.sortOrder) : 0,
      aiAssistantAvailable: mod.info?.aiAssistant === true,
    }))
}

/**
 * Every registered module an operator should see on the entitlement screen,
 * including the platform ones.
 *
 * `listEntitleableModules` deliberately omits platform modules — nothing can be
 * decided about them. But omitting them from the *screen* is a different
 * question: an operator looking for "Users" and not finding it cannot tell
 * whether it is missing or simply not theirs to control. Platform rows are
 * therefore returned with `alwaysOn: true`, rendered as a locked "Core" row.
 */
export type ModuleCatalogEntry = EntitleableModule & { alwaysOn: boolean }

export function listModuleCatalog(): ModuleCatalogEntry[] {
  const entitleable = new Map(listEntitleableModules().map((mod) => [mod.moduleId, mod]))
  return readRegistry().map((mod) => {
    const governed = entitleable.get(mod.id)
    if (governed) return { ...governed, alwaysOn: false }
    return {
      moduleId: mod.id,
      title: typeof mod.info?.title === 'string' && mod.info.title.length ? mod.info.title : mod.id,
      description: typeof mod.info?.description === 'string' && mod.info.description.length
        ? mod.info.description
        : null,
      requires: [],
      defaultEntitlement: 'enabled' as const,
      category: typeof mod.info?.category === 'string' && mod.info.category.length
        ? mod.info.category
        : UNCATEGORISED_MODULE_GROUP,
      sortOrder: Number.isFinite(mod.info?.sortOrder) ? Number(mod.info!.sortOrder) : 0,
      aiAssistantAvailable: mod.info?.aiAssistant === true,
      alwaysOn: true,
    }
  })
}

/**
 * The shipped plan for one module, as declared by its own `ModuleInfo`.
 *
 * Absent means `'disabled'`. Entitlement is fail-closed everywhere else — a
 * missing `tenant_modules` row denies — and the default has to agree with that,
 * otherwise adding a module to the build would hand it to every tenant the next
 * time anything provisioned them. Opting a module into the shipped plan is
 * therefore an explicit, reviewable declaration in its `index.ts`.
 */
function resolveDefaultEntitlement(mod: RegistryModule): 'enabled' | 'disabled' {
  return mod.info?.defaultEntitlement === 'enabled' ? 'enabled' : 'disabled'
}

/**
 * Screen order: category, then the module's declared rank, then title.
 *
 * `Other` sinks to the bottom so an unannotated module is visibly unfiled
 * rather than sorted into the middle of a real group.
 */
function compareModuleRows(
  left: { category: string; sortOrder: number; title: string },
  right: { category: string; sortOrder: number; title: string },
): number {
  const leftLast = left.category === UNCATEGORISED_MODULE_GROUP ? 1 : 0
  const rightLast = right.category === UNCATEGORISED_MODULE_GROUP ? 1 : 0
  if (leftLast !== rightLast) return leftLast - rightLast
  if (left.category !== right.category) return left.category.localeCompare(right.category)
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
  return left.title.localeCompare(right.title)
}

/** Module ids the shipped plan switches on for a newly provisioned tenant. */
export function listDefaultEnabledModuleIds(): string[] {
  return listEntitleableModules()
    .filter((mod) => mod.defaultEntitlement === 'enabled')
    .map((mod) => mod.moduleId)
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
  /** Presentational grouping; `Other` when the module declares no category. */
  category: string
  sortOrder: number
  /** Platform module — always provided, never toggleable. */
  alwaysOn: boolean
  /** Hard dependencies the operator has not enabled — the module stays unreachable until they are. */
  missingDependencies: string[]
  /** Enabled modules that would become unreachable if this one were switched off. */
  dependents: string[]
  /** When the tenant most recently gained the module, ISO-8601; null when never granted. */
  startsAt: string | null
  /** When the tenant last lost it, ISO-8601; null while the grant stands. */
  endsAt: string | null
  /** Whether the module ships an in-app AI assistant at all. */
  aiAssistantAvailable: boolean
  /** Whether that assistant is switched on for this tenant. */
  aiAssistantEnabled: boolean
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
    const rowByModuleId = new Map<string, TenantModule>()
    for (const row of Array.isArray(rows) ? rows : []) rowByModuleId.set(row.moduleId, row)

    const catalog = listModuleCatalog()
    const storedEnabled = new Set(
      catalog
        .filter((mod) => !mod.alwaysOn)
        .map((mod) => mod.moduleId)
        .filter((moduleId) => rowByModuleId.get(moduleId)?.isEnabled ?? false),
    )
    const dependentsOf = new Map<string, string[]>()
    for (const mod of catalog) {
      for (const dep of mod.requires) {
        if (!storedEnabled.has(mod.moduleId)) continue
        dependentsOf.set(dep, [...(dependentsOf.get(dep) ?? []), mod.moduleId])
      }
    }

    const toIso = (value: Date | null | undefined): string | null => (
      value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null
    )

    return catalog
      .map((mod) => {
        const row = rowByModuleId.get(mod.moduleId)
        const isEnabled = mod.alwaysOn || storedEnabled.has(mod.moduleId)
        return {
          moduleId: mod.moduleId,
          title: mod.title,
          description: mod.description,
          isEnabled,
          category: mod.category,
          sortOrder: mod.sortOrder,
          alwaysOn: mod.alwaysOn,
          missingDependencies: !mod.alwaysOn && storedEnabled.has(mod.moduleId)
            ? mod.requires.filter((dep) => !storedEnabled.has(dep))
            : [],
          dependents: dependentsOf.get(mod.moduleId) ?? [],
          // A platform module is provided by the deployment, not granted, so it
          // has no grant window to report.
          startsAt: mod.alwaysOn ? null : toIso(row?.startsAt),
          endsAt: mod.alwaysOn ? null : toIso(row?.endsAt),
          aiAssistantAvailable: mod.aiAssistantAvailable,
          aiAssistantEnabled: !mod.alwaysOn && isEnabled && (row?.aiAssistantEnabled ?? false),
        }
      })
      .sort(compareModuleRows)
  }

  /**
   * Sets the module's AI assistant for a tenant.
   *
   * Refuses when the module ships no assistant, or when the tenant does not
   * hold the module — a sub-toggle above a revoked grant would be a switch with
   * nothing behind it, and re-enabling the module later would silently restore
   * an AI state nobody chose.
   */
  async setModuleAiEnabled(tenantId: string, moduleId: string, isEnabled: boolean): Promise<void> {
    const entry = listModuleCatalog().find((mod) => mod.moduleId === moduleId)
    if (!entry || entry.alwaysOn || !entry.aiAssistantAvailable) {
      throw new Error(`[internal] ${moduleId} does not provide an AI assistant that can be entitled`)
    }
    const em = this.em.fork()
    const row = await em.findOne(TenantModule, { tenant: tenantId, moduleId } as never)
    if (!row || !row.isEnabled || row.deletedAt) {
      throw new Error(`[internal] ${moduleId} is not enabled for tenant ${tenantId}`)
    }
    if (row.aiAssistantEnabled !== isEnabled) {
      row.aiAssistantEnabled = isEnabled
      row.updatedAt = new Date()
      await em.persist(row).flush()
    }
    await this.invalidate(tenantId)
  }

  /**
   * Module ids that ship an AI assistant the tenant has switched OFF.
   *
   * The shape the AI runtime needs, and the reason it is not derived from
   * `listTenantModules`: that builds the full catalog and a dependency graph to
   * answer a screen's questions, and this runs once per MCP request and per
   * in-process client. Returning the disabled set rather than the enabled one
   * keeps the caller's test a membership check, so a module the toggle knows
   * nothing about — a built-in, a module with no assistant — stays available by
   * default.
   */
  async getAiDisabledModuleIds(tenantId: string | null | undefined): Promise<string[]> {
    if (!tenantId) return []
    const aiCapable = listModuleCatalog()
      .filter((mod) => !mod.alwaysOn && mod.aiAssistantAvailable)
      .map((mod) => mod.moduleId)
    if (!aiCapable.length) return []

    const em = this.em.fork()
    const rows = await em.find(
      TenantModule,
      { tenant: tenantId, moduleId: { $in: aiCapable }, deletedAt: null } as never,
      {},
    )
    const enabled = new Set(
      (Array.isArray(rows) ? rows : [])
        .filter((row) => row.isEnabled && row.aiAssistantEnabled)
        .map((row) => row.moduleId),
    )
    // A capable module with no row, or a row with the assistant off, is
    // disabled — same fail-closed default the grant itself uses.
    return aiCapable.filter((moduleId) => !enabled.has(moduleId))
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

  /**
   * Idempotently sets one module's entitlement for a tenant, recording the
   * grant window.
   *
   * Revocation keeps the row and stamps `endsAt` rather than deleting it, so
   * the history survives for billing, and forces the AI sub-toggle off — a
   * module switched back on later must not silently resurrect AI access the
   * operator never re-granted.
   */
  async setModuleEnabled(tenantId: string, moduleId: string, isEnabled: boolean): Promise<void> {
    if (!isEntitleableModule(moduleId)) {
      throw new Error(`[internal] ${moduleId} is a platform module and cannot be entitled per tenant`)
    }
    const now = new Date()
    const em = this.em.fork()
    const existing = await em.findOne(TenantModule, { tenant: tenantId, moduleId } as never)
    if (existing) {
      const alreadyInState = existing.isEnabled === isEnabled && !existing.deletedAt
      if (!alreadyInState) {
        existing.isEnabled = isEnabled
        existing.deletedAt = null
        existing.updatedAt = now
        if (isEnabled) {
          existing.startsAt = now
          existing.endsAt = null
        } else {
          existing.endsAt = now
          existing.aiAssistantEnabled = false
        }
        await em.persist(existing).flush()
      }
    } else {
      const tenant = await em.findOne(Tenant, { id: tenantId })
      if (!tenant) throw new Error(`[internal] tenant ${tenantId} not found`)
      em.persist(em.create(TenantModule, {
        tenant,
        moduleId,
        isEnabled,
        startsAt: isEnabled ? now : null,
        endsAt: isEnabled ? null : now,
        aiAssistantEnabled: false,
        createdAt: now,
        updatedAt: now,
      }))
      await em.flush()
    }
    await this.invalidate(tenantId)
  }

  /**
   * Ensures a row exists for every entitleable module, switched on or off
   * according to the shipped plan each module declares
   * (`ModuleInfo.defaultEntitlement`). Idempotent: existing rows keep whatever
   * entitlement an operator already chose, so re-running it after adding a
   * module records only the newly discovered ones.
   *
   * `forceEnabledByDefault` overrides the plan and switches every newly created
   * row on. It exists for environments that deliberately want the whole product
   * surface — the integration-test harness, which runs the full spec suite
   * against one tenant — and must not be used to provision a real one.
   */
  async provisionTenant(
    tenantId: string,
    options: { only?: readonly string[]; forceEnabledByDefault?: boolean } = {},
  ): Promise<{ created: string[]; existing: string[] }> {
    const plan = this.resolvePlan(options.forceEnabledByDefault)
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
      const enabled = plan.has(moduleId)
      const stamp = new Date()
      em.persist(em.create(TenantModule, {
        tenant,
        moduleId,
        isEnabled: enabled,
        startsAt: enabled ? stamp : null,
        endsAt: null,
        aiAssistantEnabled: false,
        createdAt: stamp,
        updatedAt: stamp,
      }))
      created.push(moduleId)
    }
    if (created.length) await em.flush()
    await this.invalidate(tenantId)
    if (created.length) {
      logger.info('Provisioned tenant modules', {
        tenantId,
        created: created.length,
        enabled: created.filter((moduleId) => plan.has(moduleId)).length,
      })
    }
    return { created, existing }
  }

  /**
   * Reconciles a tenant's stored entitlement against the shipped plan in both
   * directions — modules outside the plan are switched off, modules inside it
   * are switched on.
   *
   * Distinct from `provisionTenant`, which only ever fills in modules the tenant
   * has no decision recorded for. This one deliberately overwrites those
   * decisions, which is why it is never called from a tenant-creation path: it
   * is the explicit operator action behind
   * `mercato directory sync-tenant-modules --apply-defaults`.
   */
  async applyDefaultPlan(
    tenantId: string,
    options: { forceEnabledByDefault?: boolean } = {},
  ): Promise<{ enabled: string[]; disabled: string[]; unchanged: string[] }> {
    const plan = this.resolvePlan(options.forceEnabledByDefault)
    await this.provisionTenant(tenantId, { forceEnabledByDefault: options.forceEnabledByDefault })

    const em = this.em.fork()
    const rows = await em.find(TenantModule, { tenant: tenantId } as never, {})
    const enabled: string[] = []
    const disabled: string[] = []
    const unchanged: string[] = []
    let dirty = false
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!isEntitleableModule(row.moduleId)) continue
      const target = plan.has(row.moduleId)
      if (row.isEnabled === target && !row.deletedAt) {
        unchanged.push(row.moduleId)
        continue
      }
      const stamp = new Date()
      row.isEnabled = target
      row.deletedAt = null
      row.updatedAt = stamp
      if (target) {
        row.startsAt = stamp
        row.endsAt = null
      } else {
        row.endsAt = stamp
        row.aiAssistantEnabled = false
      }
      em.persist(row)
      dirty = true
      ;(target ? enabled : disabled).push(row.moduleId)
    }
    if (dirty) await em.flush()
    await this.invalidate(tenantId)
    if (dirty) {
      logger.info('Applied default module plan', {
        tenantId,
        enabled: enabled.length,
        disabled: disabled.length,
      })
    }
    return { enabled, disabled, unchanged }
  }

  /** The set of module ids the shipped plan switches on, per provisioning call. */
  private resolvePlan(forceEnabledByDefault?: boolean): Set<string> {
    return new Set(
      forceEnabledByDefault ? listEntitleableModuleIds() : listDefaultEnabledModuleIds(),
    )
  }
}
