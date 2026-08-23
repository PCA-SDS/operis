import {
  PLATFORM_MODULE_IDS,
  TenantModuleService,
  isEntitleableModule,
} from '@open-mercato/core/modules/directory/lib/tenantModules'
import { Tenant, TenantModule } from '@open-mercato/core/modules/directory/data/entities'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'

type Row = { tenant: string; moduleId: string; isEnabled: boolean; deletedAt: Date | null }

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

const TEST_MODULES: Module[] = [
  { id: 'auth' },
  { id: 'directory' },
  { id: 'customers' },
  { id: 'sales' },
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
    it('grants every registered business module and is idempotent', async () => {
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

    it('leaves an operator-disabled module disabled across re-runs', async () => {
      const em = createMockEm([{ tenant: 't1', moduleId: 'wms', isEnabled: false, deletedAt: null }])
      const service = new TenantModuleService(em)

      const result = await service.provisionTenant('t1')
      expect(result.created.sort()).toEqual(['customers', 'sales'])
      expect(await service.getEnabledModuleIds('t1')).not.toContain('wms')
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
