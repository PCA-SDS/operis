const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const roleId = '44444444-4444-4444-8444-444444444444'

const em = {
  fork: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
  remove: jest.fn(),
  flush: jest.fn(),
}

const rbac = { loadAcl: jest.fn() }

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbac
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const runRouteMutationGuardsMock = jest.fn()
const runAfterSuccessMock = jest.fn()
const getAuthFromRequestMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

jest.mock('@open-mercato/core/modules/dashboards/lib/widgets', () => ({
  loadAllWidgets: jest.fn(async () => [{ metadata: { id: 'sales-summary' } }]),
}))

import { GET, PUT } from '../route'

const foreignTenantId = '66666666-6666-4666-8666-666666666666'
const assignFeature = 'dashboards.admin.assign-widgets'

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/dashboards/roles/widgets', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function buildGetRequest(): Request {
  return new Request(`http://localhost/api/dashboards/roles/widgets?roleId=${roleId}`)
}

describe('dashboards role widgets route mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.flush.mockResolvedValue(undefined)
    em.remove.mockReturnValue({ flush: jest.fn().mockResolvedValue(undefined) })
    em.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({ id: 'rec', ...payload }))
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: true, features: [] })
    em.findOne.mockResolvedValue({ id: roleId, tenantId })
    getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
    runRouteMutationGuardsMock.mockResolvedValue({ ok: true, runAfterSuccess: runAfterSuccessMock })
    runAfterSuccessMock.mockResolvedValue(undefined)
  })

  it('short-circuits the write when the mutation guard blocks the request', async () => {
    runRouteMutationGuardsMock.mockResolvedValue({ ok: false, errorStatus: 409, errorBody: { error: 'conflict' } })

    const response = await PUT(buildRequest({ roleId, widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'conflict' })
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        container,
        input: expect.objectContaining({
          resourceKind: 'dashboards.roleWidgets',
          resourceId: roleId,
          operation: 'update',
        }),
      }),
    )
    expect(em.flush).not.toHaveBeenCalled()
    expect(runAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('runs the after-success hook after a successful write', async () => {
    em.findOne.mockResolvedValueOnce({ id: roleId, tenantId })
    em.findOne.mockResolvedValueOnce(null)

    const response = await PUT(buildRequest({ roleId, widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(200)
    expect(em.flush).toHaveBeenCalled()
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })
})

describe('dashboards role widgets route tenant ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.flush.mockResolvedValue(undefined)
    em.remove.mockReturnValue({ flush: jest.fn().mockResolvedValue(undefined) })
    em.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({ id: 'rec', ...payload }))
    em.find.mockResolvedValue([])
    runRouteMutationGuardsMock.mockResolvedValue({ ok: true, runAfterSuccess: runAfterSuccessMock })
    runAfterSuccessMock.mockResolvedValue(undefined)
  })

  it('rejects a null-tenant non-superadmin write instead of writing across tenants', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId: null, orgId: null })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, features: [assignFeature] })
    em.findOne.mockResolvedValue({ id: roleId, tenantId: foreignTenantId })

    const response = await PUT(buildRequest({ roleId, widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(403)
    expect(runRouteMutationGuardsMock).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects a null-tenant non-superadmin read of a foreign role', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId: null, orgId: null })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, features: [assignFeature] })
    em.findOne.mockResolvedValue({ id: roleId, tenantId: foreignTenantId })

    const response = await GET(buildGetRequest())

    expect(response.status).toBe(403)
    expect(em.find).not.toHaveBeenCalled()
  })

  it('keeps rejecting a tenant-scoped caller targeting a foreign role', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, features: [assignFeature] })
    em.findOne.mockResolvedValue({ id: roleId, tenantId: foreignTenantId })

    const response = await PUT(buildRequest({ roleId, widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(404)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('still lets a superadmin with no tenant scope assign widgets across tenants', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId: null, orgId: null })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: true, features: [] })
    em.findOne.mockResolvedValueOnce({ id: roleId, tenantId: foreignTenantId })
    em.findOne.mockResolvedValueOnce(null)

    const response = await PUT(buildRequest({ roleId, widgetIds: ['sales-summary'] }))

    expect(response.status).toBe(200)
    expect(em.flush).toHaveBeenCalled()
  })
})
