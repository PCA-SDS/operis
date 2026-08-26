import {
  buildModuleDependencyGraph,
  listEntitleableModules,
  resolveReachableModuleIds,
  TenantModuleService,
} from '@open-mercato/core/modules/directory/lib/tenantModules'
import { Tenant, TenantModule } from '@open-mercato/core/modules/directory/data/entities'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'

type Row = { tenant: string; moduleId: string; isEnabled: boolean; deletedAt: Date | null }

/**
 * Mirrors the real dependency shapes in the registry: `sales` needs `catalog`
 * and `customers`; `wms` needs `catalog` and `sales` (so it is transitively
 * behind `customers`); `resources` needs `planner`; `staff` needs both. `auth`
 * is a platform dependency and must never appear as a prerequisite.
 */
const TEST_MODULES: Module[] = [
  { id: 'auth' },
  { id: 'directory' },
  { id: 'catalog', info: { title: 'Product Catalog' } },
  { id: 'customers', info: { title: 'CRM', description: 'People and companies.' } },
  { id: 'sales', info: { title: 'Sales', requires: ['catalog', 'customers'] } },
  { id: 'wms', info: { title: 'Warehouse', requires: ['catalog', 'sales', 'feature_toggles'] } },
  { id: 'planner', info: { title: 'Planner' } },
  { id: 'resources', info: { title: 'Resources', requires: ['planner'] } },
  { id: 'staff', info: { title: 'Staff', requires: ['planner', 'resources'] } },
  { id: 'devices', info: { title: 'Devices', requires: ['auth'] } },
] as unknown as Module[]

function createMockEm(rows: Row[]) {
  const pending: Row[] = []
  const em: any = {
    rows,
    fork: () => em,
    async find(entity: unknown, where: any) {
      if (entity !== TenantModule) return []
      return rows.filter((row) => (
        row.tenant === where.tenant
        && (where.isEnabled === undefined || row.isEnabled === where.isEnabled)
        && (where.deletedAt !== null || row.deletedAt === null)
      ))
    },
    async findOne(entity: unknown, where: any) {
      if (entity === Tenant) return { id: where.id }
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

function stored(tenant: string, enabled: string[], disabled: string[] = []): Row[] {
  return [
    ...enabled.map((moduleId) => ({ tenant, moduleId, isEnabled: true, deletedAt: null })),
    ...disabled.map((moduleId) => ({ tenant, moduleId, isEnabled: false, deletedAt: null })),
  ]
}

beforeEach(() => {
  registerModules(TEST_MODULES)
})

describe('module dependency catalog', () => {
  it('carries display metadata from the registry', () => {
    const catalog = listEntitleableModules()
    expect(catalog.find((mod) => mod.moduleId === 'customers')).toEqual({
      moduleId: 'customers',
      title: 'CRM',
      description: 'People and companies.',
      requires: [],
      // The fixture declares no `defaultEntitlement`, and absence means off.
      defaultEntitlement: 'disabled',
      // Nor a category, so it lands in the trailing group with a neutral rank
      // and no AI assistant to entitle.
      category: 'Other',
      sortOrder: 0,
      aiAssistantAvailable: false,
    })
  })

  it('falls back to the module id when no title is declared', () => {
    expect(listEntitleableModules().find((mod) => mod.moduleId === 'catalog')?.description).toBeNull()
    expect(listEntitleableModules().find((mod) => mod.moduleId === 'auth')).toBeUndefined()
  })

  it('drops platform prerequisites, which entitlement never gates', () => {
    const graph = buildModuleDependencyGraph()
    expect(graph.get('devices')).toEqual([])
    expect(graph.get('wms')).toEqual(['catalog', 'sales'])
  })
})

describe('resolveReachableModuleIds', () => {
  it('keeps a module whose prerequisites are all enabled', () => {
    const reachable = resolveReachableModuleIds(['catalog', 'customers', 'sales'])
    expect(reachable.sort()).toEqual(['catalog', 'customers', 'sales'])
  })

  it('drops a module whose prerequisite is withheld', () => {
    expect(resolveReachableModuleIds(['catalog', 'sales'])).toEqual(['catalog'])
  })

  it('collapses a transitive chain in one pass', () => {
    // customers off ⇒ sales unreachable ⇒ wms unreachable
    expect(resolveReachableModuleIds(['catalog', 'sales', 'wms']).sort()).toEqual(['catalog'])
  })

  it('collapses the planner → resources → staff chain', () => {
    expect(resolveReachableModuleIds(['resources', 'staff'])).toEqual([])
    expect(resolveReachableModuleIds(['planner', 'resources', 'staff']).sort())
      .toEqual(['planner', 'resources', 'staff'])
  })

  it('leaves a dependency cycle intact when every member is enabled', () => {
    const cyclic = new Map<string, string[]>([['a', ['b']], ['b', ['a']]])
    expect(resolveReachableModuleIds(['a', 'b'], cyclic).sort()).toEqual(['a', 'b'])
  })

  it('is a no-op for modules with no prerequisites', () => {
    expect(resolveReachableModuleIds(['catalog', 'planner']).sort()).toEqual(['catalog', 'planner'])
  })
})

describe('TenantModuleService with dependencies', () => {
  it('reports only reachable modules to the gates', async () => {
    const service = new TenantModuleService(createMockEm(stored('t1', ['catalog', 'sales', 'wms'])) as never)
    // `sales` is stored on but `customers` is not, so neither sales nor wms resolve.
    await expect(service.getEnabledModuleIds('t1')).resolves.toEqual(['catalog'])
    await expect(service.isModuleEnabled('t1', 'wms')).resolves.toBe(false)
    await expect(service.isModuleEnabled('t1', 'catalog')).resolves.toBe(true)
  })

  it('drops grants for a module blocked by its dependency', async () => {
    const service = new TenantModuleService(createMockEm(stored('t1', ['catalog', 'sales'])) as never)
    await expect(service.filterGrantsByEntitlement('t1', ['catalog.*', 'sales.*']))
      .resolves.toEqual(['catalog.*'])
  })

  it('surfaces the stored state plus dependency context to the management screen', async () => {
    const service = new TenantModuleService(createMockEm(stored('t1', ['catalog', 'sales'])) as never)
    const rows = await service.listTenantModules('t1')
    const sales = rows.find((row) => row.moduleId === 'sales')!
    const catalog = rows.find((row) => row.moduleId === 'catalog')!
    // The toggle reflects what the operator set…
    expect(sales.isEnabled).toBe(true)
    // …and the row explains why it is not actually reachable.
    expect(sales.missingDependencies).toEqual(['customers'])
    expect(sales.title).toBe('Sales')
    // Switching catalog off would take sales with it.
    expect(catalog.dependents).toEqual(['sales'])
  })

  it('reports no missing dependencies for a module the operator left off', async () => {
    const service = new TenantModuleService(createMockEm(stored('t1', ['catalog'], ['sales'])) as never)
    const sales = (await service.listTenantModules('t1')).find((row) => row.moduleId === 'sales')!
    expect(sales.isEnabled).toBe(false)
    expect(sales.missingDependencies).toEqual([])
  })
})

describe('entitlement cache invalidation', () => {
  function createMockCache() {
    const store = new Map<string, { value: unknown; tags: string[] }>()
    return {
      store,
      async get(key: string) { return store.get(key)?.value },
      async set(key: string, value: unknown, opts?: { tags?: string[] }) {
        store.set(key, { value, tags: opts?.tags ?? [] })
      },
      async deleteByTags(tags: string[]) {
        for (const [key, entry] of store) {
          if (entry.tags.some((tag) => tags.includes(tag))) store.delete(key)
        }
      },
    }
  }

  it('drops the cached navigation payload, not just the entitlement entry', async () => {
    const cache = createMockCache()
    const service = new TenantModuleService(createMockEm(stored('t1', ['catalog'])) as never, cache as never)
    // Stand in for what the nav route caches under its own tags and 30-minute TTL.
    await cache.set('nav:sidebar:v7:en:u1:t1:o1:__all__', { groups: ['stale'] }, {
      tags: ['rbac:user:u1', 'rbac:tenant:t1', 'nav:sidebar:tenant:t1'],
    })
    await cache.set('entities:sidebar:v2:t1', { items: ['stale'] }, { tags: ['nav:entities:t1'] })
    await service.getEnabledModuleIds('t1')
    expect(cache.store.size).toBe(3)

    await service.setModuleEnabled('t1', 'customers', true)

    // Without this the sidebar would keep offering links the guards now deny.
    expect(cache.store.has('nav:sidebar:v7:en:u1:t1:o1:__all__')).toBe(false)
    expect(cache.store.has('entities:sidebar:v2:t1')).toBe(false)
    expect(cache.store.has('tenant-modules:t1')).toBe(false)
  })

  it('leaves another tenant\'s cached payloads untouched', async () => {
    const cache = createMockCache()
    const service = new TenantModuleService(createMockEm(stored('t1', ['catalog'])) as never, cache as never)
    await cache.set('nav:sidebar:other', { groups: ['keep'] }, { tags: ['nav:sidebar:tenant:t2', 'rbac:tenant:t2'] })
    await service.setModuleEnabled('t1', 'customers', true)
    expect(cache.store.has('nav:sidebar:other')).toBe(true)
  })
})
