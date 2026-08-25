/** @jest-environment node */
/**
 * The entitlement CLI must drive the container-built service.
 *
 * `TenantModuleService` takes an optional `CacheStrategy` and silently no-ops
 * its invalidation without one. A hand-rolled `new TenantModuleService(em)` in
 * a CLI command therefore wrote entitlement to the database and left every
 * cached navigation payload and RBAC decision in a running server untouched:
 * an operator switched a module off, the guards began denying it, and the
 * sidebar kept advertising it until the 30-minute TTL expired. These tests pin
 * the resolution so that cannot come back.
 */
jest.mock('@open-mercato/shared/lib/encryption/toggles', () => ({
  isTenantDataEncryptionEnabled: () => false,
  isEncryptionDebugEnabled: () => false,
}))

const resolved = new Map<string, unknown>()
const resolveSpy = jest.fn((name: string) => resolved.get(name))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (name: string) => resolveSpy(name) }),
}))

import cli from '@open-mercato/core/modules/directory/cli'

const TENANT_ID = 'bbbb8888-9999-0000-1111-222233334444'

const provisionTenant = jest.fn(async () => ({ created: [], existing: ['customers'] }))
const applyDefaultPlan = jest.fn(async () => ({ enabled: ['tasks'], disabled: ['sales'], unchanged: [] }))
const setModuleEnabled = jest.fn(async () => {})
const listTenantModules = jest.fn(async () => [
  { moduleId: 'customers', title: 'CRM', description: null, isEnabled: true, alwaysOn: false, missingDependencies: [], dependents: [] },
  { moduleId: 'sales', title: 'Sales', description: null, isEnabled: false, alwaysOn: false, missingDependencies: [], dependents: [] },
  { moduleId: 'auth', title: 'Auth', description: null, isEnabled: true, alwaysOn: true, missingDependencies: [], dependents: [] },
])

const command = (name: string) => {
  const found = (cli as Array<{ command: string; run: (rest: string[]) => Promise<void> }>)
    .find((entry) => entry.command === name)
  if (!found) throw new Error(`[internal] ${name} command not registered`)
  return found
}

describe('directory entitlement CLI', () => {
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    resolved.clear()
    resolved.set('em', { find: jest.fn(async () => [{ id: TENANT_ID }]) })
    resolved.set('tenantModuleService', {
      provisionTenant,
      applyDefaultPlan,
      setModuleEnabled,
      listTenantModules,
    })
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('resolves the cache-aware service from the container rather than constructing one', async () => {
    await command('sync-tenant-modules').run(['--tenant', TENANT_ID])

    expect(resolveSpy).toHaveBeenCalledWith('tenantModuleService')
    expect(provisionTenant).toHaveBeenCalledWith(TENANT_ID, { forceEnabledByDefault: false })
  })

  it('reconciles in both directions only when --apply-defaults is passed', async () => {
    await command('sync-tenant-modules').run(['--tenant', TENANT_ID])
    expect(applyDefaultPlan).not.toHaveBeenCalled()

    await command('sync-tenant-modules').run(['--tenant', TENANT_ID, '--apply-defaults'])
    expect(applyDefaultPlan).toHaveBeenCalledWith(TENANT_ID, { forceEnabledByDefault: false })
  })

  it('passes --enable-all through as the plan override', async () => {
    await command('sync-tenant-modules').run(['--tenant', TENANT_ID, '--apply-defaults', '--enable-all'])

    expect(applyDefaultPlan).toHaveBeenCalledWith(TENANT_ID, { forceEnabledByDefault: true })
  })

  it('drives set-tenant-module and list-tenant-modules through the same service', async () => {
    await command('set-tenant-module').run(['--tenant', TENANT_ID, '--module', 'sales', '--enabled', 'false'])
    expect(setModuleEnabled).toHaveBeenCalledWith(TENANT_ID, 'sales', false)

    await command('list-tenant-modules').run(['--tenant', TENANT_ID])
    expect(listTenantModules).toHaveBeenCalledWith(TENANT_ID)
  })

  it('marks core rows distinctly and counts only the entitleable ones', async () => {
    await command('list-tenant-modules').run(['--tenant', TENANT_ID])

    const printed = logSpy.mock.calls.map((call) => String(call[0]))
    // A plain tick on a core row would read as a decision the operator could
    // reverse, and `set-tenant-module --module auth` refuses.
    expect(printed).toContain('🔒 auth (core — always available)')
    expect(printed).toContain('✅ customers')
    expect(printed).toContain('⛔ sales')
    expect(printed.some((line) => line.includes('1/2 entitleable modules enabled'))).toBe(true)
  })
})
