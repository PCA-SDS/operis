import {
  isEntityModuleReachable,
  resolveReachableModuleSet,
} from '@open-mercato/core/modules/entities/lib/entityAcl'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import type { Module } from '@open-mercato/shared/modules/registry'

const TEST_MODULES: Module[] = [
  { id: 'auth' }, { id: 'entities' }, { id: 'directory' },
  { id: 'customers' }, { id: 'sales' }, { id: 'wms' },
] as unknown as Module[]

beforeEach(() => {
  registerModules(TEST_MODULES)
})

describe('entity metadata narrowing', () => {
  const reachable = new Set(['customers'])

  it('keeps an entity whose module the caller reaches', () => {
    expect(isEntityModuleReachable('customers:person', reachable)).toBe(true)
  })

  it('hides an entity whose module the caller lost', () => {
    // `entities` is a platform module, so the route guard never fires for this
    // payload — the narrowing here is what stops the reference leaking.
    expect(isEntityModuleReachable('sales:order', reachable)).toBe(false)
    expect(isEntityModuleReachable('wms:stock_item', reachable)).toBe(false)
  })

  it('never hides a platform-owned entity', () => {
    expect(isEntityModuleReachable('auth:user', reachable)).toBe(true)
    expect(isEntityModuleReachable('directory:tenant', reachable)).toBe(true)
    expect(isEntityModuleReachable('entities:custom_entity', reachable)).toBe(true)
  })

  it('treats an unprefixed id as its own module id', () => {
    expect(isEntityModuleReachable('customers', reachable)).toBe(true)
    expect(isEntityModuleReachable('sales', reachable)).toBe(false)
  })

  it('stands down when entitlement could not be resolved', () => {
    expect(isEntityModuleReachable('sales:order', null)).toBe(true)
  })
})

describe('tenant-created custom entities', () => {
  const reachable = new Set(['customers'])

  beforeEach(() => {
    registerEntityIds({
      customers: { person: 'customers:person' },
      sales: { order: 'sales:order' },
    } as never)
  })

  afterEach(() => {
    registerEntityIds(undefined as never)
  })

  it('keeps an entity a tenant created, whatever its free-text prefix', () => {
    expect(isEntityModuleReachable('qa20261001:asset', reachable)).toBe(true)
    expect(isEntityModuleReachable('inventory:widget', reachable)).toBe(true)
  })

  it('still hides a module-owned entity when that module is not entitled', () => {
    expect(isEntityModuleReachable('sales:order', reachable)).toBe(false)
    expect(isEntityModuleReachable('customers:person', reachable)).toBe(true)
  })

  it('keeps gating when the entity registry is not populated', () => {
    registerEntityIds(undefined as never)
    expect(isEntityModuleReachable('qa20261001:asset', reachable)).toBe(false)
  })
})

describe('resolveReachableModuleSet', () => {
  const rbac = { getReachableModuleIds: jest.fn(async () => ['customers']) }

  beforeEach(() => { rbac.getReachableModuleIds.mockClear() })

  it('resolves the set for an authenticated tenant caller', async () => {
    const set = await resolveReachableModuleSet(rbac, { sub: 'u1', tenantId: 't1', orgId: 'o1' })
    expect(set).toEqual(new Set(['customers']))
    expect(rbac.getReachableModuleIds).toHaveBeenCalledWith('u1', { tenantId: 't1', organizationId: 'o1' })
  })

  it('stands down without a tenant or subject', async () => {
    await expect(resolveReachableModuleSet(rbac, { sub: 'u1', tenantId: null })).resolves.toBeNull()
    await expect(resolveReachableModuleSet(rbac, { sub: null, tenantId: 't1' })).resolves.toBeNull()
    expect(rbac.getReachableModuleIds).not.toHaveBeenCalled()
  })

  it('stands down rather than blanking the registry when the lookup throws', async () => {
    const failing = { getReachableModuleIds: jest.fn(async () => { throw new Error('boom') }) }
    await expect(resolveReachableModuleSet(failing, { sub: 'u1', tenantId: 't1' })).resolves.toBeNull()
  })
})
