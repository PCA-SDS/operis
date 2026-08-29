import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import type { TenantModuleService } from '@open-mercato/core/modules/directory/lib/tenantModules'

type ParsedArgs = Record<string, string | boolean>

function parseArgs(rest: string[]): ParsedArgs {
  const args: ParsedArgs = {}
  for (let index = 0; index < rest.length; index += 1) {
    const part = rest[index]
    if (!part?.startsWith('--')) continue
    const [rawKey, rawValue] = part.slice(2).split('=')
    if (!rawKey) continue
    if (rawValue !== undefined) {
      args[rawKey] = rawValue
      continue
    }
    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      args[rawKey] = next
      index += 1
      continue
    }
    args[rawKey] = true
  }
  return args
}

function stringOption(args: ParsedArgs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim().length) return value.trim()
  }
  return undefined
}

/** Bare `--flag` reads as `true`; `--flag=false` keeps its explicit value. */
function flagValue(args: ParsedArgs, key: string): string | null {
  const value = args[key]
  if (value === undefined) return null
  return value === true ? 'true' : String(value)
}

/**
 * The container-built service, never a hand-rolled `new TenantModuleService(em)`.
 *
 * The DI registration injects the configured `CacheStrategy` alongside the
 * EntityManager, and the service no-ops its invalidation when that is missing.
 * Constructing it by hand therefore wrote entitlement to the database while
 * leaving every cached navigation payload and RBAC decision untouched — a
 * running server kept serving the modules an operator had just switched off,
 * until the TTL expired. Resolving picks up the cache, and any dependency the
 * service grows later.
 */
function resolveTenantModuleService(resolve: (name: string) => unknown): TenantModuleService {
  return resolve('tenantModuleService') as TenantModuleService
}

async function resolveTenantIds(em: EntityManager, tenantId: string | undefined): Promise<string[]> {
  if (tenantId) return [tenantId]
  const tenants = await em.find(Tenant, { deletedAt: null } as never, {})
  return (Array.isArray(tenants) ? tenants : []).map((tenant) => String(tenant.id))
}

/**
 * Records the shipped module plan (`ModuleInfo.defaultEntitlement`) against a
 * tenant that has no decision recorded yet. Existing rows are left alone, so an
 * operator who turned a module off keeps it off across re-runs.
 *
 * `--apply-defaults` switches to reconciliation: every entitleable module is
 * moved to what the plan says, in both directions. That deliberately overwrites
 * per-tenant choices, which is why it is opt-in rather than the default.
 *
 * `--enable-all` ignores the plan and switches everything on. It exists for the
 * integration-test environment, which runs the whole spec suite against a single
 * tenant and therefore needs the full product surface.
 */
const syncTenantModules: ModuleCli = {
  command: 'sync-tenant-modules',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = stringOption(args, 'tenant', 'tenantId')
    const applyDefaults = parseBooleanToken(flagValue(args, 'apply-defaults')) ?? false
    const forceEnabledByDefault = parseBooleanToken(flagValue(args, 'enable-all')) ?? false

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const service = resolveTenantModuleService(resolve)

    const tenantIds = await resolveTenantIds(em, tenantId)
    if (!tenantIds.length) {
      console.log('No tenants found; nothing to sync.')
      return
    }
    for (const id of tenantIds) {
      if (applyDefaults) {
        const { enabled, disabled, unchanged } = await service.applyDefaultPlan(id, { forceEnabledByDefault })
        console.log(`✅ ${id}: enabled ${enabled.length}, disabled ${disabled.length}, unchanged ${unchanged.length}`)
        if (enabled.length) console.log(`   + ${enabled.join(', ')}`)
        if (disabled.length) console.log(`   - ${disabled.join(', ')}`)
        continue
      }
      const { created, existing } = await service.provisionTenant(id, { forceEnabledByDefault })
      console.log(`✅ ${id}: recorded ${created.length} new module(s), ${existing.length} already recorded`)
      if (created.length) console.log(`   + ${created.join(', ')}`)
    }
  },
}

const listTenantModules: ModuleCli = {
  command: 'list-tenant-modules',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = stringOption(args, 'tenant', 'tenantId')
    if (!tenantId) {
      console.error('Usage: mercato directory list-tenant-modules --tenant <tenantId>')
      process.exitCode = 2
      return
    }
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const service = resolveTenantModuleService(resolve)
    const states = await service.listTenantModules(tenantId)
    if (!states.length) {
      console.log('No entitleable modules are registered in this build.')
      return
    }
    // Core rows are marked distinctly rather than printed as a plain tick: the
    // listing now includes platform modules for parity with the Modules screen,
    // and an operator reading `✅ auth` would take it for a decision they could
    // reverse — `set-tenant-module --module auth` refuses.
    for (const state of states) {
      if (state.alwaysOn) {
        console.log(`🔒 ${state.moduleId} (core — always available)`)
        continue
      }
      console.log(`${state.isEnabled ? '✅' : '⛔'} ${state.moduleId}`)
    }
    const governed = states.filter((state) => !state.alwaysOn)
    console.log(`\n${governed.filter((state) => state.isEnabled).length}/${governed.length} entitleable modules enabled`)
  },
}

const setTenantModule: ModuleCli = {
  command: 'set-tenant-module',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = stringOption(args, 'tenant', 'tenantId')
    const moduleId = stringOption(args, 'module', 'moduleId')
    const enabledRaw = args.enabled
    const enabled = parseBooleanToken(typeof enabledRaw === 'string' ? enabledRaw : enabledRaw === true ? 'true' : null)
    if (!tenantId || !moduleId || enabled === null) {
      console.error('Usage: mercato directory set-tenant-module --tenant <tenantId> --module <moduleId> --enabled <true|false>')
      process.exitCode = 2
      return
    }
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const service = resolveTenantModuleService(resolve)
    await service.setModuleEnabled(tenantId, moduleId, enabled)
    console.log(`✅ ${moduleId} is now ${enabled ? 'enabled' : 'disabled'} for tenant ${tenantId}`)
  },
}

export default [syncTenantModules, listTenantModules, setTenantModule]
