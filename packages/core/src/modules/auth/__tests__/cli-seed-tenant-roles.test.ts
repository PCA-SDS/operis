/** @jest-environment node */
//
// The one property this command exists to guarantee: a seeded tenant's primary user
// is a TENANT admin, never a platform superadmin.
//
// `auth setup` — the command this one is modelled on — always mints a superadmin, and
// says so in its own header. Seeded that way, admin@y.com could read and write every
// other tenant, so every cross-tenant isolation test in the QA fixture would pass
// vacuously. That failure is invisible from the outside: the tenant looks correct, the
// user logs in, the data is there. Only the role grant differs.
//
// These assertions are on the options handed to `setupInitialTenant`, because that is
// where the distinction lives — `primaryUserRoles` defaults to ['superadmin'] when the
// caller omits it.
jest.mock('@open-mercato/shared/lib/encryption/toggles', () => ({
  isTenantDataEncryptionEnabled: () => false,
  isEncryptionDebugEnabled: () => false,
}))

const setupInitialTenantMock = jest.fn(async () => ({
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  users: [],
  reusedExistingUser: false,
}))
const ensureTenantUserMock = jest.fn(async () => ({ user: { id: 'user-1' }, created: true }))

jest.mock('@open-mercato/core/modules/auth/lib/setup-app', () => ({
  ...jest.requireActual('@open-mercato/core/modules/auth/lib/setup-app'),
  setupInitialTenant: (...args: unknown[]) => (setupInitialTenantMock as any)(...args),
  ensureTenantUser: (...args: unknown[]) => (ensureTenantUserMock as any)(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (_: string) => ({}) }),
}))

import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { registerCliModules } from '@open-mercato/shared/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import cli from '@open-mercato/core/modules/auth/cli'

jest.setTimeout(60_000)

const testModules: Module[] = [
  { id: 'auth', setup: { defaultRoleFeatures: { admin: ['auth.*'] } } },
  { id: 'directory', setup: { defaultRoleFeatures: { admin: ['directory.*'] } } },
]
registerModules(testModules)
registerCliModules(testModules)

const seedTenant = cli.find((c: any) => c.command === 'seed-tenant')!
const PASSWORD = 'Password@123'

describe('mercato auth seed-tenant', () => {
  let logSpy: jest.SpyInstance
  let errSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    process.exitCode = undefined
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    logSpy.mockRestore()
    errSpy.mockRestore()
    process.exitCode = undefined
  })

  it('grants the primary user admin, never superadmin', async () => {
    await seedTenant.run([
      '--orgName', 'organization-y',
      '--admin', 'admin@y.com',
      '--user', 'user@y.com',
      '--password', PASSWORD,
    ])

    expect(setupInitialTenantMock).toHaveBeenCalledTimes(1)
    const options = (setupInitialTenantMock.mock.calls[0] as any[])[1]

    expect(options.primaryUser.email).toBe('admin@y.com')
    expect(options.primaryUserRoles).toEqual(['admin'])
    expect(options.primaryUserRoles).not.toContain('superadmin')
  })

  it('keeps the superadmin role present but unheld, and seeds no demo accounts', async () => {
    await seedTenant.run([
      '--orgName', 'organization-y',
      '--admin', 'admin@y.com',
      '--password', PASSWORD,
    ])

    const options = (setupInitialTenantMock.mock.calls[0] as any[])[1]
    // The role still EXISTS in the tenant, as it does in production — what differs is
    // that the seeded user does not hold it. Dropping the role entirely would make the
    // fixture diverge from the shape QA is meant to be testing against.
    expect(options.includeSuperadminRole).toBe(true)
    // No admin@acme.com / employee@acme.com turning up beside the intended fixtures.
    expect(options.includeDerivedUsers).toBe(false)
  })

  it('runs the per-tenant module setup hooks', async () => {
    await seedTenant.run([
      '--orgName', 'organization-y',
      '--admin', 'admin@y.com',
      '--password', PASSWORD,
    ])

    // Omitting `modules` is what `auth add-org` effectively does, and it leaves the
    // tenant without dashboards, configs, feature toggles or query-index rows.
    const options = (setupInitialTenantMock.mock.calls[0] as any[])[1]
    expect(Array.isArray(options.modules)).toBe(true)
    expect(options.modules.length).toBeGreaterThan(0)
  })

  it('adds the second account as an employee', async () => {
    await seedTenant.run([
      '--orgName', 'organization-y',
      '--admin', 'admin@y.com',
      '--user', 'user@y.com',
      '--password', PASSWORD,
    ])

    expect(ensureTenantUserMock).toHaveBeenCalledTimes(1)
    const options = (ensureTenantUserMock.mock.calls[0] as any[])[1]
    expect(options.email).toBe('user@y.com')
    expect(options.roles).toEqual(['employee'])
    expect(options.tenantId).toBe('tenant-1')
    expect(options.organizationId).toBe('org-1')
  })

  it('promotes a lone user to primary as an employee, not an admin', async () => {
    // organization-jules has no admin. The tenant is still legitimate, so the lone user
    // becomes the primary account — but must not inherit admin just for being first.
    await seedTenant.run([
      '--orgName', 'organization-jules',
      '--user', 'user@jules.com',
      '--password', PASSWORD,
    ])

    const options = (setupInitialTenantMock.mock.calls[0] as any[])[1]
    expect(options.primaryUser.email).toBe('user@jules.com')
    expect(options.primaryUserRoles).toEqual(['employee'])
    expect(ensureTenantUserMock).not.toHaveBeenCalled()
  })

  it('refuses a password that fails the policy, before touching the database', async () => {
    await seedTenant.run([
      '--orgName', 'organization-y',
      '--admin', 'admin@y.com',
      '--password', 'weak',
    ])

    expect(setupInitialTenantMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('requires at least one email', async () => {
    await seedTenant.run(['--orgName', 'organization-y', '--password', PASSWORD])

    expect(setupInitialTenantMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })
})
