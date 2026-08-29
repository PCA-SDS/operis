import {
  PLATFORM_MODULE_IDS,
  TenantModuleService,
  isEntitleableModule,
} from '@open-mercato/core/modules/directory/lib/tenantModules'
import { Tenant, TenantModule } from '@open-mercato/core/modules/directory/data/entities'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'

type Row = {
  tenant: string
  moduleId: string
  isEnabled: boolean
  deletedAt: Date | null
  startsAt?: Date | null
  endsAt?: Date | null
  aiAssistantEnabled?: boolean
}

/**
 * Minimal EntityManager stand-in backed by an array, exercising only the
 * find/findOne/create/persist/flush surface TenantModuleService uses.
 */
function createMockEm(rows: Row[] = []) {
  const pending: Row[] = []
  const em: any = {
    rows,
    fork: () => em,
    async find(entity: unknown, where: any) {
      if (entity !== TenantModule) return []
      return rows.filter((row) => {
        if (where.tenant && row.tenant !== where.tenant) return false
        if (where.isEnabled !== undefined && row.isEnabled !== where.isEnabled) return false
        if (where.deletedAt === null && row.deletedAt !== null) return false
        return true
      })
    },
    async findOne(entity: unknown, where: any) {
      if (entity === Tenant) return where.id === 'missing-tenant' ? null : { id: where.id }
      if (entity !== TenantModule) return null
      return rows.find((row) => row.tenant === where.tenant && row.moduleId === where.moduleId) ?? null
    },
    create(_entity: unknown, data: any) {
      return { ...data, tenant: data.tenant?.id ?? data.tenant, deletedAt: null }
    },
    persist(row: Row) {
      if (!rows.includes(row) && !pending.includes(row)) pending.push(row)
      return em
    },
    async flush() {
      rows.push(...pending.splice(0, pending.length))
    },
  }
  return em
}

// `customers` opts into the shipped plan; `sales` and `wms` do not declare one
// and therefore default to disabled — the fail-closed rule under test.
const TEST_MODULES: Module[] = [
  { id: 'auth' },
  { id: 'directory' },
  {
    id: 'customers',
    info: { defaultEntitlement: 'enabled', category: 'Sales', sortOrder: 1, aiAssistant: true },
  },
  { id: 'sales', info: { category: 'Sales', sortOrder: 2 } },
  { id: 'wms' },
] as unknown as Module[]

describe('tenant module entitlement', () => {
  beforeEach(() => {
    registerModules(TEST_MODULES)
  })

  describe('isEntitleableModule', () => {
    it('never governs platform infrastructure modules', () => {
      for (const moduleId of PLATFORM_MODULE_IDS) {
        expect(isEntitleableModule(moduleId)).toBe(false)
      }
    })

    it('governs business modules', () => {
      expect(isEntitleableModule('customers')).toBe(true)
      expect(isEntitleableModule('sales')).toBe(true)
      expect(isEntitleableModule('wms')).toBe(true)
    })
  })

  describe('getEnabledModuleIds', () => {
    it('returns only modules with an enabled row', async () => {
      const em = createMockEm([
        { tenant: 't1', moduleId: 'customers', isEnabled: true, deletedAt: null },
        { tenant: 't1', moduleId: 'wms', isEnabled: false, deletedAt: null },
        { tenant: 't2', moduleId: 'sales', isEnabled: true, deletedAt: null },
      ])
      const service = new TenantModuleService(em)
      await expect(service.getEnabledModuleIds('t1')).resolves.toEqual(['customers'])
    })

    it('returns nothing for a tenant that was never provisioned', async () => {
      const service = new TenantModuleService(createMockEm([]))
      await expect(service.getEnabledModuleIds('t-unprovisioned')).resolves.toEqual([])
    })
  })

  describe('isModuleEnabled', () => {
    it('always allows platform modules, even for an unprovisioned tenant', async () => {
      const service = new TenantModuleService(createMockEm([]))
      await expect(service.isModuleEnabled('t1', 'auth')).resolves.toBe(true)
      await expect(service.isModuleEnabled('t1', 'directory')).resolves.toBe(true)
    })

    it('denies a business module without an enabled row', async () => {
      const em = createMockEm([{ tenant: 't1', moduleId: 'wms', isEnabled: false, deletedAt: null }])
      const service = new TenantModuleService(em)
      await expect(service.isModuleEnabled('t1', 'wms')).resolves.toBe(false)
      await expect(service.isModuleEnabled('t1', 'sales')).resolves.toBe(false)
    })
  })

  describe('filterGrantsByEntitlement', () => {
    it('drops grants owned by a withheld module and keeps platform grants', async () => {
      const em = createMockEm([
        { tenant: 't1', moduleId: 'customers', isEnabled: true, deletedAt: null },
        { tenant: 't1', moduleId: 'wms', isEnabled: false, deletedAt: null },
      ])
      const service = new TenantModuleService(em)
      const filtered = await service.filterGrantsByEntitlement('t1', [
        'auth.users.view',
        'customers.people.view',
        'wms.stock.view',
        'sales.orders.view',
      ])
      expect(filtered).toEqual(['auth.users.view', 'customers.people.view'])
    })

    it('drops a wildcard grant for a withheld module', async () => {
      const em = createMockEm([{ tenant: 't1', moduleId: 'customers', isEnabled: true, deletedAt: null }])
      const service = new TenantModuleService(em)
      const filtered = await service.filterGrantsByEntitlement('t1', ['customers.*', 'wms.*'])
      expect(filtered).toEqual(['customers.*'])
    })
  })

  describe('expandUnrestrictedGrants', () => {
    it('expands a superadmin grant to platform modules plus entitled modules only', async () => {
      const em = createMockEm([
        { tenant: 't1', moduleId: 'customers', isEnabled: true, deletedAt: null },
        { tenant: 't1', moduleId: 'wms', isEnabled: false, deletedAt: null },
      ])
      const service = new TenantModuleService(em)
      const grants = await service.expandUnrestrictedGrants('t1')
      expect(grants).toContain('auth.*')
      expect(grants).toContain('customers.*')
      expect(grants).not.toContain('wms.*')
    })
  })

  describe('provisionTenant', () => {
    it('records every registered business module and is idempotent', async () => {
      const em = createMockEm([])
      const service = new TenantModuleService(em)

      const first = await service.provisionTenant('t1')
      expect(first.created.sort()).toEqual(['customers', 'sales', 'wms'])
      expect(first.existing).toEqual([])

      const second = await service.provisionTenant('t1')
      expect(second.created).toEqual([])
      expect(second.existing.sort()).toEqual(['customers', 'sales', 'wms'])
      expect(em.rows).toHaveLength(3)
    })

    it('switches on only the modules the shipped plan declares', async () => {
      const em = createMockEm([])
      const service = new TenantModuleService(em)

      await service.provisionTenant('t1')

      expect(await service.getEnabledModuleIds('t1')).toEqual(['customers'])
    })

    it('switches everything on under forceEnabledByDefault', async () => {
      const em = createMockEm([])
      const service = new TenantModuleService(em)

      await service.provisionTenant('t1', { forceEnabledByDefault: true })

      expect((await service.getEnabledModuleIds('t1')).sort()).toEqual(['customers', 'sales', 'wms'])
    })

    it('leaves an operator-disabled module disabled across re-runs', async () => {
      const em = createMockEm([{ tenant: 't1', moduleId: 'customers', isEnabled: false, deletedAt: null }])
      const service = new TenantModuleService(em)

      const result = await service.provisionTenant('t1')
      expect(result.created.sort()).toEqual(['sales', 'wms'])
      expect(await service.getEnabledModuleIds('t1')).not.toContain('customers')
    })
  })

  describe('listTenantModules', () => {
    it('includes platform modules as locked core rows', async () => {
      const service = new TenantModuleService(createMockEm([]))

      const rows = await service.listTenantModules('t1')
      const core = rows.filter((row) => row.alwaysOn).map((row) => row.moduleId).sort()

      // Hiding them would leave an operator unable to tell "not provided" from
      // "not mine to control".
      expect(core).toEqual(['auth', 'directory'])
      expect(rows.find((row) => row.moduleId === 'auth')?.isEnabled).toBe(true)
    })

    it('reports the grant window and leaves core rows without one', async () => {
      const granted = new Date('2026-02-03T10:00:00.000Z')
      const em = createMockEm([
        { tenant: 't1', moduleId: 'customers', isEnabled: true, deletedAt: null, startsAt: granted },
      ])
      const service = new TenantModuleService(em)

      const rows = await service.listTenantModules('t1')

      expect(rows.find((row) => row.moduleId === 'customers')?.startsAt).toBe(granted.toISOString())
      expect(rows.find((row) => row.moduleId === 'customers')?.endsAt).toBeNull()
      expect(rows.find((row) => row.moduleId === 'auth')?.startsAt).toBeNull()
    })

    it('sorts by category, then rank, then title, with uncategorised last', async () => {
      const service = new TenantModuleService(createMockEm([]))

      const categories = (await service.listTenantModules('t1')).map((row) => row.category)

      expect(categories[categories.length - 1]).toBe('Other')
      expect([...categories].sort((left, right) => (
        (left === 'Other' ? 1 : 0) - (right === 'Other' ? 1 : 0) || left.localeCompare(right)
      ))).toEqual(categories)
    })

    it('never reports an AI assistant as on for a module that is off', async () => {
      const em = createMockEm([
        { tenant: 't1', moduleId: 'customers', isEnabled: false, deletedAt: null, aiAssistantEnabled: true },
      ])
      const service = new TenantModuleService(em)

      const row = (await service.listTenantModules('t1')).find((entry) => entry.moduleId === 'customers')

      expect(row?.isEnabled).toBe(false)
      expect(row?.aiAssistantEnabled).toBe(false)
    })
  })

  describe('setModuleEnabled', () => {
    it('stamps the grant window rather than deleting the row', async () => {
      const em = createMockEm([])
      const service = new TenantModuleService(em)

      await service.setModuleEnabled('t1', 'customers', true)
      const granted = em.rows.find((row: Row) => row.moduleId === 'customers')
      expect(granted.startsAt).toBeInstanceOf(Date)
      expect(granted.endsAt).toBeNull()

      await service.setModuleEnabled('t1', 'customers', false)
      const revoked = em.rows.find((row: Row) => row.moduleId === 'customers')
      // The row survives — "when did this tenant have this module" is a billing
      // question a delete would destroy the answer to.
      expect(revoked.isEnabled).toBe(false)
      expect(revoked.endsAt).toBeInstanceOf(Date)
    })

    it('forces the AI assistant off when the grant is revoked', async () => {
      const em = createMockEm([
        { tenant: 't1', moduleId: 'customers', isEnabled: true, deletedAt: null, aiAssistantEnabled: true },
      ])
      const service = new TenantModuleService(em)

      await service.setModuleEnabled('t1', 'customers', false)

      // Otherwise re-enabling the module later would silently restore AI access
      // nobody re-granted.
      expect(em.rows.find((row: Row) => row.moduleId === 'customers').aiAssistantEnabled).toBe(false)
    })
  })

  describe('setModuleAiEnabled', () => {
    it('refuses a module that ships no AI assistant', async () => {
      const em = createMockEm([{ tenant: 't1', moduleId: 'sales', isEnabled: true, deletedAt: null }])
      const service = new TenantModuleService(em)

      await expect(service.setModuleAiEnabled('t1', 'sales', true)).rejects.toThrow(/AI assistant/)
    })

    it('refuses a module the tenant does not hold', async () => {
      const em = createMockEm([{ tenant: 't1', moduleId: 'customers', isEnabled: false, deletedAt: null }])
      const service = new TenantModuleService(em)

      await expect(service.setModuleAiEnabled('t1', 'customers', true)).rejects.toThrow(/not enabled/)
    })

    it('switches the assistant on for a granted module', async () => {
      const em = createMockEm([{ tenant: 't1', moduleId: 'customers', isEnabled: true, deletedAt: null }])
      const service = new TenantModuleService(em)

      await service.setModuleAiEnabled('t1', 'customers', true)

      expect(em.rows.find((row: Row) => row.moduleId === 'customers').aiAssistantEnabled).toBe(true)
      await expect(service.getAiDisabledModuleIds('t1')).resolves.toEqual([])
    })
  })

  describe('getAiDisabledModuleIds', () => {
    it('reports an AI-capable module whose assistant is off', async () => {
      const em = createMockEm([{ tenant: 't1', moduleId: 'customers', isEnabled: true, deletedAt: null }])
      const service = new TenantModuleService(em)

      await expect(service.getAiDisabledModuleIds('t1')).resolves.toEqual(['customers'])
    })

    it('reports an AI-capable module with no row at all', async () => {
      const service = new TenantModuleService(createMockEm([]))

      // No row means no grant, which means no assistant — the same fail-closed
      // default the grant itself uses.
      await expect(service.getAiDisabledModuleIds('t1')).resolves.toEqual(['customers'])
    })

    it('ignores modules that ship no assistant', async () => {
      const em = createMockEm([
        { tenant: 't1', moduleId: 'sales', isEnabled: true, deletedAt: null },
      ])
      const service = new TenantModuleService(em)

      // `sales` is not "AI disabled" — it has no assistant to disable.
      await expect(service.getAiDisabledModuleIds('t1')).resolves.toEqual(['customers'])
    })

    it('narrows nothing without a tenant', async () => {
      const service = new TenantModuleService(createMockEm([]))
      await expect(service.getAiDisabledModuleIds(null)).resolves.toEqual([])
    })
  })

  describe('applyDefaultPlan', () => {
    it('reconciles in both directions against the shipped plan', async () => {
      const em = createMockEm([
        { tenant: 't1', moduleId: 'customers', isEnabled: false, deletedAt: null },
        { tenant: 't1', moduleId: 'sales', isEnabled: true, deletedAt: null },
        { tenant: 't1', moduleId: 'wms', isEnabled: true, deletedAt: null },
      ])
      const service = new TenantModuleService(em)

      const result = await service.applyDefaultPlan('t1')

      expect(result.enabled).toEqual(['customers'])
      expect(result.disabled.sort()).toEqual(['sales', 'wms'])
      expect(await service.getEnabledModuleIds('t1')).toEqual(['customers'])
    })

    it('reports no change when the tenant already matches the plan', async () => {
      const em = createMockEm([
        { tenant: 't1', moduleId: 'customers', isEnabled: true, deletedAt: null },
        { tenant: 't1', moduleId: 'sales', isEnabled: false, deletedAt: null },
        { tenant: 't1', moduleId: 'wms', isEnabled: false, deletedAt: null },
      ])
      const service = new TenantModuleService(em)

      const result = await service.applyDefaultPlan('t1')

      expect(result.enabled).toEqual([])
      expect(result.disabled).toEqual([])
      expect(result.unchanged.sort()).toEqual(['customers', 'sales', 'wms'])
    })

    it('provisions missing rows before reconciling', async () => {
      const em = createMockEm([])
      const service = new TenantModuleService(em)

      const result = await service.applyDefaultPlan('t1')

      expect(em.rows).toHaveLength(3)
      expect(result.unchanged.sort()).toEqual(['customers', 'sales', 'wms'])
      expect(await service.getEnabledModuleIds('t1')).toEqual(['customers'])
    })

    it('switches everything on under forceEnabledByDefault', async () => {
      const em = createMockEm([
        { tenant: 't1', moduleId: 'customers', isEnabled: true, deletedAt: null },
        { tenant: 't1', moduleId: 'sales', isEnabled: false, deletedAt: null },
        { tenant: 't1', moduleId: 'wms', isEnabled: false, deletedAt: null },
      ])
      const service = new TenantModuleService(em)

      const result = await service.applyDefaultPlan('t1', { forceEnabledByDefault: true })

      expect(result.enabled.sort()).toEqual(['sales', 'wms'])
      expect((await service.getEnabledModuleIds('t1')).sort()).toEqual(['customers', 'sales', 'wms'])
    })
  })

  describe('setModuleEnabled', () => {
    it('refuses to record entitlement for a platform module', async () => {
      const service = new TenantModuleService(createMockEm([]))
      await expect(service.setModuleEnabled('t1', 'auth', false)).rejects.toThrow(/platform module/)
    })

    it('toggles an existing row without duplicating it', async () => {
      const em = createMockEm([{ tenant: 't1', moduleId: 'wms', isEnabled: true, deletedAt: null }])
      const service = new TenantModuleService(em)
      await service.setModuleEnabled('t1', 'wms', false)
      expect(em.rows).toHaveLength(1)
      expect(await service.getEnabledModuleIds('t1')).toEqual([])
    })
  })
})
