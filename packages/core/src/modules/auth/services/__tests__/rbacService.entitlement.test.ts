import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { TenantModule } from '@open-mercato/core/modules/directory/data/entities'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'

type Row = { tenant: string; moduleId: string; isEnabled: boolean; deletedAt: Date | null }

const TEST_MODULES: Module[] = [
  { id: 'auth', features: [{ id: 'auth.users.view', title: 'View users', module: 'auth' }] },
  { id: 'directory', features: [{ id: 'directory.tenants.view', title: 'View tenants', module: 'directory' }] },
  { id: 'customers', features: [{ id: 'customers.people.view', title: 'View people', module: 'customers' }] },
  { id: 'wms', features: [{ id: 'wms.stock.view', title: 'View stock', module: 'wms' }] },
] as unknown as Module[]

/** EntityManager stand-in that only needs to answer TenantModule lookups. */
function createEm(rows: Row[]) {
  const em: any = {
    fork: () => em,
    async find(entity: unknown, where: any) {
      if (entity !== TenantModule) return []
      return rows.filter((row) => (
        row.tenant === where.tenant
        && (where.isEnabled === undefined || row.isEnabled === where.isEnabled)
        && (where.deletedAt !== null || row.deletedAt === null)
      ))
    },
    async findOne() { return null },
  }
  return em
}

/** Acme has customers, but WMS was never granted. */
const ACME_ROWS: Row[] = [
  { tenant: 'acme', moduleId: 'customers', isEnabled: true, deletedAt: null },
  { tenant: 'acme', moduleId: 'wms', isEnabled: false, deletedAt: null },
]

const SCOPE = { tenantId: 'acme', organizationId: 'acme-org' }

describe('RbacService — per-tenant module entitlement', () => {
  beforeEach(() => {
    registerModules(TEST_MODULES)
  })

  function serviceWithAcl(acl: { isSuperAdmin: boolean; features: string[]; organizations: string[] | null }) {
    const service = new RbacService(createEm(ACME_ROWS) as any)
    jest.spyOn(service, 'loadAcl').mockResolvedValue(acl)
    return service
  }

  it('denies a feature whose module the tenant was not granted', async () => {
    const service = serviceWithAcl({ isSuperAdmin: false, features: ['customers.*', 'wms.*'], organizations: null })
    await expect(service.userHasAllFeatures('u1', ['customers.people.view'], SCOPE)).resolves.toBe(true)
    await expect(service.userHasAllFeatures('u1', ['wms.stock.view'], SCOPE)).resolves.toBe(false)
  })

  it('denies a withheld module even for a super admin', async () => {
    const service = serviceWithAcl({ isSuperAdmin: true, features: ['*'], organizations: null })
    await expect(service.userHasAllFeatures('root', ['customers.people.view'], SCOPE)).resolves.toBe(true)
    await expect(service.userHasAllFeatures('root', ['wms.stock.view'], SCOPE)).resolves.toBe(false)
  })

  it('never gates platform modules on entitlement', async () => {
    const service = serviceWithAcl({ isSuperAdmin: false, features: ['auth.*', 'directory.*'], organizations: null })
    await expect(service.userHasAllFeatures('u1', ['auth.users.view'], SCOPE)).resolves.toBe(true)
    await expect(service.userHasAllFeatures('u1', ['directory.tenants.view'], SCOPE)).resolves.toBe(true)
  })

  it('denies when any one of several required features is withheld', async () => {
    const service = serviceWithAcl({ isSuperAdmin: false, features: ['*'], organizations: null })
    await expect(
      service.userHasAllFeatures('u1', ['customers.people.view', 'wms.stock.view'], SCOPE),
    ).resolves.toBe(false)
  })

  it('keeps withheld modules out of the browser capability payload', async () => {
    const service = serviceWithAcl({ isSuperAdmin: false, features: ['customers.*', 'wms.*'], organizations: null })
    const effective = await service.getEffectiveFeatures('u1', SCOPE)
    expect(effective).toContain('customers.people.view')
    expect(effective).not.toContain('wms.stock.view')
  })

  it('keeps withheld modules out of a super admin capability payload', async () => {
    const service = serviceWithAcl({ isSuperAdmin: true, features: ['*'], organizations: null })
    const effective = await service.getEffectiveFeatures('root', SCOPE)
    expect(effective).toContain('customers.people.view')
    expect(effective).toContain('auth.users.view')
    expect(effective).not.toContain('wms.stock.view')
  })

  it('drops withheld grants from getGrantedFeatures', async () => {
    const service = serviceWithAcl({ isSuperAdmin: false, features: ['customers.*', 'wms.*'], organizations: null })
    const granted = await service.getGrantedFeatures('u1', SCOPE)
    expect(granted).toContain('customers.*')
    expect(granted).not.toContain('wms.*')
  })

  it('denies every business module for a tenant that was never provisioned', async () => {
    const service = new RbacService(createEm([]) as any)
    jest.spyOn(service, 'loadAcl').mockResolvedValue({ isSuperAdmin: true, features: ['*'], organizations: null })
    await expect(
      service.userHasAllFeatures('root', ['customers.people.view'], { tenantId: 'ghost', organizationId: null }),
    ).resolves.toBe(false)
    // …while platform modules stay reachable so the tenant can still be administered.
    await expect(
      service.userHasAllFeatures('root', ['directory.tenants.view'], { tenantId: 'ghost', organizationId: null }),
    ).resolves.toBe(true)
  })

  it('stands down when there is no tenant to entitle', async () => {
    const service = serviceWithAcl({ isSuperAdmin: false, features: ['wms.*'], organizations: null })
    await expect(
      service.userHasAllFeatures('u1', ['wms.stock.view'], { tenantId: null, organizationId: null }),
    ).resolves.toBe(true)
  })
})
