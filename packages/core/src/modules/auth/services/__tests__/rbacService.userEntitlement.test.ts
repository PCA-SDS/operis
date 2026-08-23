import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { TenantModule } from '@open-mercato/core/modules/directory/data/entities'
import { UserModule } from '@open-mercato/core/modules/auth/data/entities'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'

type TenantRow = { tenant: string; moduleId: string; isEnabled: boolean; deletedAt: Date | null }
type UserRow = { user: string; tenantId: string | null; moduleId: string; isEnabled: boolean; deletedAt: Date | null }

const TEST_MODULES: Module[] = [
  { id: 'auth', features: [{ id: 'auth.users.view', title: 'View users', module: 'auth' }] },
  { id: 'directory', features: [{ id: 'directory.tenants.view', title: 'View tenants', module: 'directory' }] },
  { id: 'customers', features: [{ id: 'customers.people.view', title: 'View people', module: 'customers' }] },
  { id: 'wms', features: [{ id: 'wms.stock.view', title: 'View stock', module: 'wms' }] },
  { id: 'sales', features: [{ id: 'sales.orders.view', title: 'View orders', module: 'sales' }] },
] as unknown as Module[]

// Real user ids are database uuids; the restriction lookup only addresses uuids
// so that `api_key:<id>` subjects never reach an invalid-uuid comparison.
const UNRESTRICTED_USER = '11111111-1111-4111-8111-111111111111'
const RESTRICTED_USER = '22222222-2222-4222-8222-222222222222'
const OTHER_TENANT_USER = '33333333-3333-4333-8333-333333333333'

/** Acme holds customers and WMS; sales was never granted. Globex holds WMS. */
const TENANT_ROWS: TenantRow[] = [
  { tenant: 'acme', moduleId: 'customers', isEnabled: true, deletedAt: null },
  { tenant: 'acme', moduleId: 'wms', isEnabled: true, deletedAt: null },
  { tenant: 'acme', moduleId: 'sales', isEnabled: false, deletedAt: null },
  { tenant: 'globex', moduleId: 'wms', isEnabled: true, deletedAt: null },
]

/**
 * The restricted Acme user has WMS withheld. They also carry an `is_enabled:
 * true` row for `sales` — a module their tenant does NOT hold — to prove the
 * user layer cannot hand back what the Super Admin withheld.
 */
const USER_ROWS: UserRow[] = [
  { user: RESTRICTED_USER, tenantId: 'acme', moduleId: 'wms', isEnabled: false, deletedAt: null },
  { user: RESTRICTED_USER, tenantId: 'acme', moduleId: 'sales', isEnabled: true, deletedAt: null },
]

function createEm(tenantRows: TenantRow[], userRows: UserRow[]) {
  const em: any = {
    fork: () => em,
    async find(entity: unknown, where: any) {
      if (entity === TenantModule) {
        return tenantRows.filter((row) => (
          row.tenant === where.tenant
          && (where.isEnabled === undefined || row.isEnabled === where.isEnabled)
          && (where.deletedAt !== null || row.deletedAt === null)
        ))
      }
      if (entity === UserModule) {
        return userRows.filter((row) => (
          row.user === where.user
          && (where.isEnabled === undefined || row.isEnabled === where.isEnabled)
          && (where.deletedAt !== null || row.deletedAt === null)
        ))
      }
      return []
    },
    async findOne() { return null },
  }
  return em
}

const ACME_SCOPE = { tenantId: 'acme', organizationId: 'acme-org' }
const GLOBEX_SCOPE = { tenantId: 'globex', organizationId: 'globex-org' }

describe('RbacService — per-user module restrictions', () => {
  beforeEach(() => {
    registerModules(TEST_MODULES)
  })

  function serviceWithAcl(acl: { isSuperAdmin: boolean; features: string[]; organizations: string[] | null }) {
    const service = new RbacService(createEm(TENANT_ROWS, USER_ROWS) as any)
    jest.spyOn(service, 'loadAcl').mockResolvedValue(acl)
    return service
  }

  const grantsEverything = { isSuperAdmin: false, features: ['customers.*', 'wms.*', 'sales.*'], organizations: null }

  describe('the effective-access truth table', () => {
    it('tenant enabled + user unrestricted + grant => allowed', async () => {
      const service = serviceWithAcl(grantsEverything)
      await expect(service.userHasAllFeatures(UNRESTRICTED_USER, ['wms.stock.view'], ACME_SCOPE)).resolves.toBe(true)
    })

    it('tenant enabled + user restricted + grant => denied', async () => {
      const service = serviceWithAcl(grantsEverything)
      await expect(service.userHasAllFeatures(RESTRICTED_USER, ['wms.stock.view'], ACME_SCOPE)).resolves.toBe(false)
    })

    it('tenant disabled + user unrestricted + grant => denied', async () => {
      const service = serviceWithAcl(grantsEverything)
      await expect(service.userHasAllFeatures(UNRESTRICTED_USER, ['sales.orders.view'], ACME_SCOPE)).resolves.toBe(false)
    })

    it('tenant disabled + a user row saying enabled => still denied (the user layer only subtracts)', async () => {
      const service = serviceWithAcl(grantsEverything)
      await expect(service.userHasAllFeatures(RESTRICTED_USER, ['sales.orders.view'], ACME_SCOPE)).resolves.toBe(false)
    })

    it('tenant enabled + user unrestricted + no grant => denied (RBAC still applies)', async () => {
      const service = serviceWithAcl({ isSuperAdmin: false, features: ['customers.*'], organizations: null })
      await expect(service.userHasAllFeatures(UNRESTRICTED_USER, ['wms.stock.view'], ACME_SCOPE)).resolves.toBe(false)
    })
  })

  it('denies a restricted module ahead of the super-admin bypass', async () => {
    const service = serviceWithAcl({ isSuperAdmin: true, features: ['*'], organizations: null })
    await expect(service.userHasAllFeatures(RESTRICTED_USER, ['customers.people.view'], ACME_SCOPE)).resolves.toBe(true)
    await expect(service.userHasAllFeatures(RESTRICTED_USER, ['wms.stock.view'], ACME_SCOPE)).resolves.toBe(false)
  })

  it('denies when any one of several required features is restricted', async () => {
    const service = serviceWithAcl(grantsEverything)
    await expect(
      service.userHasAllFeatures(RESTRICTED_USER, ['customers.people.view', 'wms.stock.view'], ACME_SCOPE),
    ).resolves.toBe(false)
  })

  it('never restricts platform modules per user', async () => {
    const service = new RbacService(createEm(TENANT_ROWS, [
      ...USER_ROWS,
      { user: RESTRICTED_USER, tenantId: 'acme', moduleId: 'auth', isEnabled: false, deletedAt: null },
    ]) as any)
    jest.spyOn(service, 'loadAcl').mockResolvedValue({ isSuperAdmin: false, features: ['auth.*'], organizations: null })
    await expect(service.userHasAllFeatures(RESTRICTED_USER, ['auth.users.view'], ACME_SCOPE)).resolves.toBe(true)
  })

  it('keeps restricted modules out of the browser capability payload', async () => {
    const service = serviceWithAcl(grantsEverything)
    const effective = await service.getEffectiveFeatures(RESTRICTED_USER, ACME_SCOPE)
    expect(effective).toContain('customers.people.view')
    expect(effective).not.toContain('wms.stock.view')
    expect(effective).not.toContain('sales.orders.view')
  })

  it('keeps restricted modules out of a super admin capability payload', async () => {
    const service = serviceWithAcl({ isSuperAdmin: true, features: ['*'], organizations: null })
    const effective = await service.getEffectiveFeatures(RESTRICTED_USER, ACME_SCOPE)
    expect(effective).toContain('customers.people.view')
    expect(effective).not.toContain('wms.stock.view')
  })

  it('drops restricted grants from getGrantedFeatures', async () => {
    const service = serviceWithAcl(grantsEverything)
    const granted = await service.getGrantedFeatures(RESTRICTED_USER, ACME_SCOPE)
    expect(granted).toContain('customers.*')
    expect(granted).not.toContain('wms.*')
  })

  it('leaves an unrestricted colleague in the same tenant untouched', async () => {
    const service = serviceWithAcl(grantsEverything)
    const effective = await service.getEffectiveFeatures(UNRESTRICTED_USER, ACME_SCOPE)
    expect(effective).toContain('wms.stock.view')
    expect(effective).toContain('customers.people.view')
  })

  it("does not let one tenant's user restrictions touch another tenant", async () => {
    const service = serviceWithAcl({ isSuperAdmin: false, features: ['wms.*'], organizations: null })
    await expect(service.userHasAllFeatures(OTHER_TENANT_USER, ['wms.stock.view'], GLOBEX_SCOPE)).resolves.toBe(true)
  })

  it('carries a restriction with the user when they are evaluated in another tenant scope', async () => {
    // The restriction row is read by user id, not by tenant, so a row that
    // outlived a tenant move keeps applying. Reading restrictions too narrowly
    // would widen access; too widely only ever narrows it.
    const service = serviceWithAcl({ isSuperAdmin: false, features: ['wms.*'], organizations: null })
    await expect(service.userHasAllFeatures(RESTRICTED_USER, ['wms.stock.view'], GLOBEX_SCOPE)).resolves.toBe(false)
  })

  it('applies no restrictions to an api-key subject', async () => {
    const service = serviceWithAcl(grantsEverything)
    await expect(service.userHasAllFeatures('api_key:abc', ['wms.stock.view'], ACME_SCOPE)).resolves.toBe(true)
  })

  it('stands down when there is no tenant to entitle', async () => {
    const service = serviceWithAcl(grantsEverything)
    await expect(
      service.userHasAllFeatures(RESTRICTED_USER, ['wms.stock.view'], { tenantId: null, organizationId: null }),
    ).resolves.toBe(true)
  })
})

describe('RbacService.isModuleAllowedForUser — route-level module reachability', () => {
  beforeEach(() => {
    registerModules(TEST_MODULES)
  })

  function service() {
    return new RbacService(createEm(TENANT_ROWS, USER_ROWS) as any)
  }

  it('allows a module the tenant holds and the user is not restricted from', async () => {
    await expect(service().isModuleAllowedForUser(UNRESTRICTED_USER, 'wms', ACME_SCOPE)).resolves.toBe(true)
  })

  it('denies a module the tenant admin withheld from this user', async () => {
    await expect(service().isModuleAllowedForUser(RESTRICTED_USER, 'wms', ACME_SCOPE)).resolves.toBe(false)
  })

  it('denies a module the tenant does not hold, for every user', async () => {
    await expect(service().isModuleAllowedForUser(UNRESTRICTED_USER, 'sales', ACME_SCOPE)).resolves.toBe(false)
    await expect(service().isModuleAllowedForUser(RESTRICTED_USER, 'sales', ACME_SCOPE)).resolves.toBe(false)
  })

  it('never gates a platform module', async () => {
    await expect(service().isModuleAllowedForUser(RESTRICTED_USER, 'auth', ACME_SCOPE)).resolves.toBe(true)
    await expect(service().isModuleAllowedForUser(RESTRICTED_USER, 'directory', ACME_SCOPE)).resolves.toBe(true)
  })

  it('gates a route that declares no features at all — the reason this method exists', async () => {
    // `userHasAllFeatures([])` short-circuits to true, so an unguarded route would
    // otherwise stay reachable in a tenant that never bought the module.
    await expect(service().userHasAllFeatures(UNRESTRICTED_USER, [], ACME_SCOPE)).resolves.toBe(true)
    await expect(service().isModuleAllowedForUser(UNRESTRICTED_USER, 'sales', ACME_SCOPE)).resolves.toBe(false)
  })

  it('stands down without a tenant', async () => {
    await expect(
      service().isModuleAllowedForUser(RESTRICTED_USER, 'wms', { tenantId: null, organizationId: null }),
    ).resolves.toBe(true)
  })
})

describe('RbacService.getReachableModuleIds — the navigation surface', () => {
  beforeEach(() => {
    registerModules(TEST_MODULES)
  })

  function service() {
    return new RbacService(createEm(TENANT_ROWS, USER_ROWS) as any)
  }

  it('returns what the tenant holds minus what the user is restricted from', async () => {
    await expect(service().getReachableModuleIds(UNRESTRICTED_USER, ACME_SCOPE))
      .resolves.toEqual(expect.arrayContaining(['customers', 'wms']))
    const restricted = await service().getReachableModuleIds(RESTRICTED_USER, ACME_SCOPE)
    expect(restricted).toContain('customers')
    expect(restricted).not.toContain('wms')
  })

  it('never includes a module the tenant does not hold', async () => {
    const reachable = await service().getReachableModuleIds(UNRESTRICTED_USER, ACME_SCOPE)
    expect(reachable).not.toContain('sales')
  })

  it('is tenant scoped — one tenant\'s set says nothing about another', async () => {
    const globex = await service().getReachableModuleIds(OTHER_TENANT_USER, GLOBEX_SCOPE)
    expect(globex).toEqual(['wms'])
    expect(globex).not.toContain('customers')
  })

  it('stands down to the full catalog without a tenant', async () => {
    const reachable = await service().getReachableModuleIds(RESTRICTED_USER, { tenantId: null, organizationId: null })
    expect(reachable).toEqual(expect.arrayContaining(['customers', 'wms', 'sales']))
  })
})
