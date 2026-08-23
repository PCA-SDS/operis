/** @jest-environment node */

const ACME = '11111111-1111-4111-8111-111111111111'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

import { setTenantModuleCommand } from '../tenantModules'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'

const TEST_MODULES: Module[] = [
  { id: 'auth' },
  { id: 'directory' },
  { id: 'catalog' },
  { id: 'customers' },
  { id: 'sales', info: { requires: ['catalog', 'customers'] } },
  { id: 'wms', info: { requires: ['catalog', 'sales'] } },
] as unknown as Module[]

const setModuleEnabled = jest.fn(async () => {})
const isModuleEnabled = jest.fn(async () => false)
/** Stored entitlement the command reads before deciding. Catalog + customers on. */
const listTenantModules = jest.fn(async () => ([
  { moduleId: 'catalog', title: 'catalog', description: null, isEnabled: true, missingDependencies: [], dependents: ['sales'] },
  { moduleId: 'customers', title: 'customers', description: null, isEnabled: true, missingDependencies: [], dependents: ['sales'] },
  { moduleId: 'sales', title: 'sales', description: null, isEnabled: false, missingDependencies: [], dependents: [] },
  { moduleId: 'wms', title: 'wms', description: null, isEnabled: false, missingDependencies: [], dependents: [] },
]))

function makeCtx(isSuperAdmin: boolean) {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'tenantModuleService') return { setModuleEnabled, isModuleEnabled, listTenantModules }
        if (name === 'rbacService') {
          return { loadAcl: async () => ({ isSuperAdmin, features: [], organizations: null }) }
        }
        throw new Error(`Unexpected container resolve: ${name}`)
      },
    },
    auth: { sub: 'actor-1', tenantId: ACME, orgId: null },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  registerModules(TEST_MODULES)
})

describe('directory.tenant_modules.set', () => {
  it('grants a module when a platform super admin asks', async () => {
    const result = await setTenantModuleCommand.execute(
      { tenantId: ACME, moduleId: 'sales', isEnabled: true },
      makeCtx(true),
    )
    expect(setModuleEnabled).toHaveBeenCalledWith(ACME, 'sales', true)
    expect(result).toMatchObject({ tenantId: ACME, moduleId: 'sales', isEnabled: true, previousIsEnabled: false })
  })

  it('refuses to enable a module whose prerequisite is withheld', async () => {
    // `wms` needs `sales`, which is stored off — enabling it would record a
    // switch that resolution keeps unreachable anyway.
    await expect(setTenantModuleCommand.execute(
      { tenantId: ACME, moduleId: 'wms', isEnabled: true },
      makeCtx(true),
    )).rejects.toMatchObject({ status: 400 })
    expect(setModuleEnabled).not.toHaveBeenCalled()
  })

  it('reports the dependents a switch-off takes with it', async () => {
    listTenantModules.mockResolvedValueOnce([
      { moduleId: 'catalog', title: 'catalog', description: null, isEnabled: true, missingDependencies: [], dependents: ['sales'] },
      { moduleId: 'customers', title: 'customers', description: null, isEnabled: true, missingDependencies: [], dependents: ['sales'] },
      { moduleId: 'sales', title: 'sales', description: null, isEnabled: true, missingDependencies: [], dependents: ['wms'] },
      { moduleId: 'wms', title: 'wms', description: null, isEnabled: true, missingDependencies: [], dependents: [] },
    ])
    const result = await setTenantModuleCommand.execute(
      { tenantId: ACME, moduleId: 'catalog', isEnabled: false },
      makeCtx(true),
    )
    // Transitive: catalog off ⇒ sales unreachable ⇒ wms unreachable.
    expect(result.cascadedOff).toEqual(['sales', 'wms'])
  })

  it('refuses a tenant admin — entitlement is the platform\'s lever, not the tenant\'s', async () => {
    await expect(setTenantModuleCommand.execute(
      { tenantId: ACME, moduleId: 'sales', isEnabled: true },
      makeCtx(false),
    )).rejects.toMatchObject({ status: 403 })
    expect(setModuleEnabled).not.toHaveBeenCalled()
  })

  it('refuses a platform module', async () => {
    await expect(setTenantModuleCommand.execute(
      { tenantId: ACME, moduleId: 'auth', isEnabled: false },
      makeCtx(true),
    )).rejects.toMatchObject({ status: 400 })
    expect(setModuleEnabled).not.toHaveBeenCalled()
  })

  it('records the old and new value for the audit trail', async () => {
    const result = await setTenantModuleCommand.execute(
      { tenantId: ACME, moduleId: 'sales', isEnabled: true },
      makeCtx(true),
    )
    const log = setTenantModuleCommand.buildLog!({
      input: { tenantId: ACME, moduleId: 'sales', isEnabled: true },
      result,
      ctx: makeCtx(true),
      snapshots: {},
    })
    expect(log).toMatchObject({
      tenantId: ACME,
      actorUserId: 'actor-1',
      resourceKind: 'directory.tenant_module',
      resourceId: `${ACME}:sales`,
      changes: { isEnabled: { from: false, to: true } },
    })
  })
})
