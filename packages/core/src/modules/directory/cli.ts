import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { TenantModuleService } from '@open-mercato/core/modules/directory/lib/tenantModules'

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

async function resolveTenantIds(em: EntityManager, tenantId: string | undefined): Promise<string[]> {
  if (tenantId) return [tenantId]
  const tenants = await em.find(Tenant, { deletedAt: null } as never, {})
  return (Array.isArray(tenants) ? tenants : []).map((tenant) => String(tenant.id))
}

/**
 * Grants every registered business module to a tenant that does not already
 * have a decision recorded for it. Existing rows are left alone, so an operator
 * who turned a module off keeps it off across re-runs.
 */
const syncTenantModules: ModuleCli = {
  command: 'sync-tenant-modules',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = stringOption(args, 'tenant', 'tenantId')
    const disabledRaw = args.disabled ?? args['enabled-by-default']
    const enabledByDefault = args.disabled !== undefined
      ? !(parseBooleanToken(typeof disabledRaw === 'string' ? disabledRaw : 'true') ?? true)
      : true

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const service = new TenantModuleService(em)

    const tenantIds = await resolveTenantIds(em, tenantId)
    if (!tenantIds.length) {
      console.log('No tenants found; nothing to sync.')
      return
    }
    for (const id of tenantIds) {
      const { created, existing } = await service.provisionTenant(id, { enabledByDefault })
      console.log(`✅ ${id}: granted ${created.length} new module(s), ${existing.length} already recorded`)
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
    const service = new TenantModuleService(em)
    const states = await service.listTenantModules(tenantId)
    if (!states.length) {
      console.log('No entitleable modules are registered in this build.')
      return
    }
    for (const state of states) {
      console.log(`${state.isEnabled ? '✅' : '⛔'} ${state.moduleId}`)
    }
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
    const service = new TenantModuleService(em)
    await service.setModuleEnabled(tenantId, moduleId, enabled)
    console.log(`✅ ${moduleId} is now ${enabled ? 'enabled' : 'disabled'} for tenant ${tenantId}`)
  },
}

export default [syncTenantModules, listTenantModules, setTenantModule]
