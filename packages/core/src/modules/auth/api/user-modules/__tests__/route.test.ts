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

const commandBusExecute = jest.fn(async () => ({ result: null, logEntry: null }))
const getEnabledModuleIds = jest.fn(async () => ['customers', 'wms'])
const listUserModules = jest.fn(async () => ([
  { moduleId: 'customers', isEnabled: true },
  { moduleId: 'wms', isEnabled: false },
]))

const em = {
  fork: () => em,
  findOne: jest.fn(async (_entity: unknown, where: { id: string }) => users[where.id] ?? null),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'commandBus') return { execute: commandBusExecute }
    if (name === 'tenantModuleService') return { getEnabledModuleIds }
    if (name === 'userModuleService') return { listUserModules }
    if (name === 'rbacService') return { loadAcl: async () => ({ isSuperAdmin: false, features: [], organizations: null }) }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const getAuthFromRequestMock = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

import { GET, PUT, metadata } from '../route'

function makeAuth(overrides: Record<string, unknown> = {}) {
  return { sub: 'actor-1', tenantId: ACME, orgId: 'acme-org', isSuperAdmin: false, ...overrides }
}

function getRequest(userId: string) {
  return new Request(`http://localhost/api/auth/user-modules?userId=${userId}`)
}

function putRequest(body: unknown) {
  return new Request('http://localhost/api/auth/user-modules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  getAuthFromRequestMock.mockResolvedValue(makeAuth())
  commandBusExecute.mockResolvedValue({ result: null, logEntry: null })
})

describe('/api/auth/user-modules', () => {
  it('declares separate view and manage feature guards', () => {
    expect(metadata.GET.requireFeatures).toEqual(['auth.users.modules.view'])
    expect(metadata.PUT.requireFeatures).toEqual(['auth.users.modules.manage'])
  })

  describe('GET', () => {
    it('rejects an unauthenticated caller', async () => {
      getAuthFromRequestMock.mockResolvedValue(null)
      const res = await GET(getRequest(ACME_USER))
      expect(res.status).toBe(401)
    })

    it('rejects a missing userId', async () => {
      const res = await GET(new Request('http://localhost/api/auth/user-modules'))
      expect(res.status).toBe(400)
    })

    it('returns 404 for a user that does not exist', async () => {
      const res = await GET(getRequest(MISSING_USER))
      expect(res.status).toBe(404)
    })

    it('lists availability for a user in the caller\'s own tenant', async () => {
      const res = await GET(getRequest(ACME_USER))
      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({
        items: [
          { moduleId: 'customers', isEnabled: true },
          { moduleId: 'wms', isEnabled: false },
        ],
      })
      // Only the tenant's entitled modules are ever offered as options.
      expect(getEnabledModuleIds).toHaveBeenCalledWith(ACME)
      expect(listUserModules).toHaveBeenCalledWith(ACME_USER, ACME, ['customers', 'wms'])
    })

    it('refuses to read a user belonging to another tenant', async () => {
      const res = await GET(getRequest(GLOBEX_USER))
      expect(res.status).toBe(403)
      expect(listUserModules).not.toHaveBeenCalled()
    })

    it('lets a platform super admin read across tenants', async () => {
      getAuthFromRequestMock.mockResolvedValue(makeAuth({ isSuperAdmin: true }))
      const res = await GET(getRequest(GLOBEX_USER))
      expect(res.status).toBe(200)
      expect(getEnabledModuleIds).toHaveBeenCalledWith(GLOBEX)
    })
  })

  describe('PUT', () => {
    it('rejects an unauthenticated caller', async () => {
      getAuthFromRequestMock.mockResolvedValue(null)
      const res = await PUT(putRequest({ userId: ACME_USER, moduleId: 'wms', isEnabled: false }))
      expect(res.status).toBe(401)
      expect(commandBusExecute).not.toHaveBeenCalled()
    })

    it('rejects a malformed body', async () => {
      const res = await PUT(putRequest({ userId: 'not-a-uuid', moduleId: 'wms', isEnabled: false }))
      expect(res.status).toBe(400)
      expect(commandBusExecute).not.toHaveBeenCalled()
    })

    it('dispatches the audited command', async () => {
      const res = await PUT(putRequest({ userId: ACME_USER, moduleId: 'wms', isEnabled: false }))
      expect(res.status).toBe(200)
      expect(commandBusExecute).toHaveBeenCalledWith(
        'auth.user_modules.set',
        expect.objectContaining({ input: { userId: ACME_USER, moduleId: 'wms', isEnabled: false } }),
      )
    })

    it('surfaces the command\'s FEATURE_NOT_AVAILABLE verdict verbatim', async () => {
      const { featureNotAvailable } = await import('@open-mercato/shared/security/entitlementErrors')
      commandBusExecute.mockRejectedValue(featureNotAvailable('Not available to the tenant', 'wms'))
      const res = await PUT(putRequest({ userId: ACME_USER, moduleId: 'wms', isEnabled: true }))
      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toEqual({
        error: 'Not available to the tenant',
        code: 'FEATURE_NOT_AVAILABLE',
        moduleId: 'wms',
      })
    })
  })
})
