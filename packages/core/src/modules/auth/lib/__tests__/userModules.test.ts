import { UserModuleService } from '@open-mercato/core/modules/auth/lib/userModules'
import { User, UserModule } from '@open-mercato/core/modules/auth/data/entities'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'

type Row = { user: string; tenantId: string | null; moduleId: string; isEnabled: boolean; deletedAt: Date | null }

const USER_ID = '11111111-1111-4111-8111-111111111111'
const MISSING_USER_ID = '99999999-9999-4999-8999-999999999999'

/**
 * Minimal EntityManager stand-in backed by an array, exercising only the
 * find/findOne/create/persist/flush surface UserModuleService uses.
 */
function createMockEm(rows: Row[] = []) {
  const pending: Row[] = []
  const em: any = {
    rows,
    fork: () => em,
    async find(entity: unknown, where: any) {
      if (entity !== UserModule) return []
      return rows.filter((row) => {
        if (where.user && row.user !== where.user) return false
        if (where.isEnabled !== undefined && row.isEnabled !== where.isEnabled) return false
        if (where.deletedAt === null && row.deletedAt !== null) return false
        return true
      })
    },
    async findOne(entity: unknown, where: any) {
      if (entity === User) return where.id === MISSING_USER_ID ? null : { id: where.id }
      if (entity !== UserModule) return null
      return rows.find((row) => row.user === where.user && row.moduleId === where.moduleId) ?? null
    },
    create(_entity: unknown, data: any) {
      return { ...data, user: data.user?.id ?? data.user, deletedAt: null }
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
  { id: 'customers', info: { title: 'CRM' } },
  { id: 'sales', info: { title: 'Sales' } },
  { id: 'wms', info: { title: 'Warehouse', description: 'Stock and picking.' } },
] as unknown as Module[]

describe('per-user module restrictions', () => {
  beforeEach(() => {
    registerModules(TEST_MODULES)
  })

  describe('getRestrictedModuleIds', () => {
    it('returns only modules with a withheld row', async () => {
      const service = new UserModuleService(createMockEm([
        { user: USER_ID, tenantId: 't1', moduleId: 'wms', isEnabled: false, deletedAt: null },
        { user: USER_ID, tenantId: 't1', moduleId: 'customers', isEnabled: true, deletedAt: null },
      ]))
      await expect(service.getRestrictedModuleIds(USER_ID, 't1')).resolves.toEqual(['wms'])
    })

    it('returns nothing for a user with no rows', async () => {
      const service = new UserModuleService(createMockEm([]))
      await expect(service.getRestrictedModuleIds(USER_ID, 't1')).resolves.toEqual([])
    })

    it('ignores a withheld platform module', async () => {
      const service = new UserModuleService(createMockEm([
        { user: USER_ID, tenantId: 't1', moduleId: 'auth', isEnabled: false, deletedAt: null },
      ]))
      await expect(service.getRestrictedModuleIds(USER_ID, 't1')).resolves.toEqual([])
    })

    it('never queries for an api-key subject', async () => {
      const em = createMockEm([])
      const findSpy = jest.spyOn(em, 'find')
      const service = new UserModuleService(em)
      await expect(service.getRestrictedModuleIds('api_key:abc', 't1')).resolves.toEqual([])
      expect(findSpy).not.toHaveBeenCalled()
    })
  })

  describe('filterModuleIds — subtract only', () => {
    it('removes restricted ids and adds nothing', async () => {
      const service = new UserModuleService(createMockEm([
        { user: USER_ID, tenantId: 't1', moduleId: 'wms', isEnabled: false, deletedAt: null },
      ]))
      await expect(service.filterModuleIds(USER_ID, 't1', ['customers', 'wms'])).resolves.toEqual(['customers'])
    })

    it('cannot introduce a module the caller did not pass in', async () => {
      // The user carries an `is_enabled: true` row for `sales`, which is not in
      // the tenant's entitled set. A subtract-only filter must not surface it.
      const service = new UserModuleService(createMockEm([
        { user: USER_ID, tenantId: 't1', moduleId: 'sales', isEnabled: true, deletedAt: null },
      ]))
      await expect(service.filterModuleIds(USER_ID, 't1', ['customers'])).resolves.toEqual(['customers'])
    })
  })

  describe('filterGrantsByRestrictions', () => {
    it('drops grants owned by a restricted module, wildcards included', async () => {
      const service = new UserModuleService(createMockEm([
        { user: USER_ID, tenantId: 't1', moduleId: 'wms', isEnabled: false, deletedAt: null },
      ]))
      await expect(
        service.filterGrantsByRestrictions(USER_ID, 't1', ['customers.*', 'wms.*', 'wms.stock.view']),
      ).resolves.toEqual(['customers.*'])
    })

    it('keeps platform grants regardless of restrictions', async () => {
      const service = new UserModuleService(createMockEm([
        { user: USER_ID, tenantId: 't1', moduleId: 'wms', isEnabled: false, deletedAt: null },
      ]))
      await expect(
        service.filterGrantsByRestrictions(USER_ID, 't1', ['auth.users.list', 'directory.tenants.view']),
      ).resolves.toEqual(['auth.users.list', 'directory.tenants.view'])
    })
  })

  describe('listUserModules', () => {
    it('lists only what the tenant is entitled to, marking withheld modules', async () => {
      const service = new UserModuleService(createMockEm([
        { user: USER_ID, tenantId: 't1', moduleId: 'wms', isEnabled: false, deletedAt: null },
      ]))
      // Rows carry the registry's display metadata so the screen shows real
      // module names rather than raw ids, and come back in registry order.
      await expect(service.listUserModules(USER_ID, 't1', ['wms', 'customers'])).resolves.toEqual([
        { moduleId: 'customers', title: 'CRM', description: null, isEnabled: true },
        { moduleId: 'wms', title: 'Warehouse', description: 'Stock and picking.', isEnabled: false },
      ])
    })

    it('omits a module the tenant does not hold, so it cannot be offered', async () => {
      const service = new UserModuleService(createMockEm([]))
      const rows = await service.listUserModules(USER_ID, 't1', ['customers'])
      expect(rows.map((row) => row.moduleId)).not.toContain('sales')
    })
  })

  describe('setModuleEnabled', () => {
    it('writes a row only when withholding — "allowed" is the absence of one', async () => {
      const em = createMockEm([])
      const service = new UserModuleService(em)
      await service.setModuleEnabled(USER_ID, 't1', 'wms', true)
      expect(em.rows).toHaveLength(0)
      await service.setModuleEnabled(USER_ID, 't1', 'wms', false)
      expect(em.rows).toHaveLength(1)
      expect(em.rows[0]).toMatchObject({ user: USER_ID, moduleId: 'wms', isEnabled: false })
    })

    it('clears an existing restriction by flipping the row', async () => {
      const em = createMockEm([
        { user: USER_ID, tenantId: 't1', moduleId: 'wms', isEnabled: false, deletedAt: null },
      ])
      const service = new UserModuleService(em)
      await service.setModuleEnabled(USER_ID, 't1', 'wms', true)
      await expect(service.getRestrictedModuleIds(USER_ID, 't1')).resolves.toEqual([])
    })

    it('is idempotent', async () => {
      const em = createMockEm([])
      const service = new UserModuleService(em)
      await service.setModuleEnabled(USER_ID, 't1', 'wms', false)
      await service.setModuleEnabled(USER_ID, 't1', 'wms', false)
      expect(em.rows).toHaveLength(1)
    })

    it('refuses to restrict a platform module', async () => {
      const service = new UserModuleService(createMockEm([]))
      await expect(service.setModuleEnabled(USER_ID, 't1', 'auth', false)).rejects.toThrow(/platform module/)
    })

    it('refuses to write for a user that does not exist', async () => {
      const service = new UserModuleService(createMockEm([]))
      await expect(service.setModuleEnabled(MISSING_USER_ID, 't1', 'wms', false)).rejects.toThrow(/not found/)
    })
  })

  describe('cache isolation', () => {
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

    it('keys entries per tenant and per user so no set is shared', async () => {
      const cache = createMockCache()
      const other = '22222222-2222-4222-8222-222222222222'
      const service = new UserModuleService(createMockEm([
        { user: USER_ID, tenantId: 't1', moduleId: 'wms', isEnabled: false, deletedAt: null },
      ]), cache as never)
      await service.getRestrictedModuleIds(USER_ID, 't1')
      await service.getRestrictedModuleIds(other, 't2')
      expect(Array.from(cache.store.keys()).sort()).toEqual([
        `user-modules:t1:${USER_ID}`,
        `user-modules:t2:${other}`,
      ])
      expect(cache.store.get(`user-modules:t2:${other}`)?.value).toEqual([])
    })

    it('drops the cached set when a restriction changes, so revocation is not stale', async () => {
      const cache = createMockCache()
      const em = createMockEm([])
      const service = new UserModuleService(em, cache as never)
      await expect(service.getRestrictedModuleIds(USER_ID, 't1')).resolves.toEqual([])
      await service.setModuleEnabled(USER_ID, 't1', 'wms', false)
      await expect(service.getRestrictedModuleIds(USER_ID, 't1')).resolves.toEqual(['wms'])
    })
  })
})

describe('user entitlement cache invalidation', () => {
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

  it('drops the user\'s cached navigation payload so no dead links survive', async () => {
    const cache = createMockCache()
    const service = new UserModuleService(createMockEm([]), cache as never)
    await cache.set(`nav:sidebar:v7:en:${USER_ID}:t1:o1:__all__`, { groups: ['stale'] }, {
      tags: [`rbac:user:${USER_ID}`, `nav:sidebar:user:${USER_ID}`],
    })
    await service.setModuleEnabled(USER_ID, 't1', 'wms', false)
    expect(cache.store.has(`nav:sidebar:v7:en:${USER_ID}:t1:o1:__all__`)).toBe(false)
  })

  it('leaves a colleague\'s cached payload untouched', async () => {
    const cache = createMockCache()
    const other = '22222222-2222-4222-8222-222222222222'
    const service = new UserModuleService(createMockEm([]), cache as never)
    await cache.set('nav:sidebar:other', { groups: ['keep'] }, {
      tags: [`rbac:user:${other}`, `nav:sidebar:user:${other}`],
    })
    await service.setModuleEnabled(USER_ID, 't1', 'wms', false)
    expect(cache.store.has('nav:sidebar:other')).toBe(true)
  })
})
