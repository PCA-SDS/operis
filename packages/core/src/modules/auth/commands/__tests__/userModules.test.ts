/** @jest-environment node */

const ACME = '11111111-1111-4111-8111-111111111111'
const GLOBEX = '22222222-2222-4222-8222-222222222222'
const ACME_USER = '33333333-3333-4333-8333-333333333333'
const GLOBEX_USER = '44444444-4444-4444-8444-444444444444'
const MISSING_USER = '55555555-5555-4555-8555-555555555555'

const users: Record<string, { id: string; tenantId: string } | null> = {
  [ACME_USER]: { id: ACME_USER, tenantId: ACME },
  [GLOBEX_USER]: { id: GLOBEX_USER, tenantId: GLOBEX },
  [MISSING_USER]: null,
}

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

import { setUserModuleCommand } from '../userModules'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import { FEATURE_NOT_AVAILABLE } from '@open-mercato/shared/security/entitlementErrors'

const TEST_MODULES: Module[] = [
  { id: 'auth' }, { id: 'directory' }, { id: 'customers' }, { id: 'wms' },
] as unknown as Module[]

const setModuleEnabled = jest.fn(async () => {})
const getRestrictedModuleIds = jest.fn(async () => [] as string[])
const isModuleEnabled = jest.fn(async (_tenantId: string | null, moduleId: string) => moduleId === 'customers')

const em = {
  fork: () => em,
  findOne: jest.fn(async (_entity: unknown, where: { id: string }) => users[where.id] ?? null),
}

function makeCtx(auth: Record<string, unknown> | null) {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'userModuleService') return { setModuleEnabled, getRestrictedModuleIds }
        if (name === 'tenantModuleService') return { isModuleEnabled }
        if (name === 'rbacService') {
          return { loadAcl: async () => ({ isSuperAdmin: false, features: [], organizations: null }) }
        }
        throw new Error(`Unexpected container resolve: ${name}`)
      },
    },
    auth,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  registerModules(TEST_MODULES)
  isModuleEnabled.mockImplementation(async (_tenantId: string | null, moduleId: string) => moduleId === 'customers')
  getRestrictedModuleIds.mockResolvedValue([])
})

describe('auth.user_modules.set', () => {
  const actor = { sub: 'admin-1', tenantId: ACME, orgId: 'acme-org' }

  it('withholds a module the tenant holds', async () => {
    const result = await setUserModuleCommand.execute(
      { userId: ACME_USER, moduleId: 'customers', isEnabled: false },
      makeCtx(actor),
    )
    expect(setModuleEnabled).toHaveBeenCalledWith(ACME_USER, ACME, 'customers', false)
    expect(result).toMatchObject({ userId: ACME_USER, tenantId: ACME, moduleId: 'customers', isEnabled: false })
  })

  it('refuses a module the tenant is not entitled to (Rule 2)', async () => {
    await expect(setUserModuleCommand.execute(
      { userId: ACME_USER, moduleId: 'wms', isEnabled: true },
      makeCtx(actor),
    )).rejects.toMatchObject({ status: 403, body: { code: FEATURE_NOT_AVAILABLE, moduleId: 'wms' } })
    expect(setModuleEnabled).not.toHaveBeenCalled()
  })

  it('refuses to withhold a module the tenant is not entitled to either', async () => {
    await expect(setUserModuleCommand.execute(
      { userId: ACME_USER, moduleId: 'wms', isEnabled: false },
      makeCtx(actor),
    )).rejects.toMatchObject({ status: 403 })
    expect(setModuleEnabled).not.toHaveBeenCalled()
  })

  it('refuses a platform module', async () => {
    await expect(setUserModuleCommand.execute(
      { userId: ACME_USER, moduleId: 'auth', isEnabled: false },
      makeCtx(actor),
    )).rejects.toMatchObject({ status: 400 })
    expect(setModuleEnabled).not.toHaveBeenCalled()
  })

  it('refuses to touch a user in another tenant', async () => {
    await expect(setUserModuleCommand.execute(
      { userId: GLOBEX_USER, moduleId: 'customers', isEnabled: false },
      makeCtx(actor),
    )).rejects.toMatchObject({ status: 403 })
    expect(setModuleEnabled).not.toHaveBeenCalled()
  })

  it('refuses an unknown user', async () => {
    await expect(setUserModuleCommand.execute(
      { userId: MISSING_USER, moduleId: 'customers', isEnabled: false },
      makeCtx(actor),
    )).rejects.toMatchObject({ status: 404 })
  })

  it('rejects a malformed payload before any lookup', async () => {
    await expect(setUserModuleCommand.execute(
      { userId: 'nope', moduleId: 'customers', isEnabled: false } as never,
      makeCtx(actor),
    )).rejects.toThrow()
    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('records the old and new value for the audit trail', async () => {
    getRestrictedModuleIds.mockResolvedValue(['customers'])
    const result = await setUserModuleCommand.execute(
      { userId: ACME_USER, moduleId: 'customers', isEnabled: true },
      makeCtx(actor),
    )
    const log = setUserModuleCommand.buildLog!({
      input: { userId: ACME_USER, moduleId: 'customers', isEnabled: true },
      result,
      ctx: makeCtx(actor),
      snapshots: {},
    })
    expect(log).toMatchObject({
      tenantId: ACME,
      actorUserId: 'admin-1',
      resourceKind: 'auth.user_module',
      resourceId: `${ACME_USER}:customers`,
      changes: { isEnabled: { from: false, to: true } },
    })
  })
})
