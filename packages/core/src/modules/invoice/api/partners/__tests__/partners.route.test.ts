import type { AwilixContainer } from 'awilix'

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockResolveTranslations = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockRunRouteMutationGuards = jest.fn()
const mockEnforceCommandOptimisticLockWithGuards = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => mockResolveTranslations(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => mockRunRouteMutationGuards(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: (...args: unknown[]) =>
    mockEnforceCommandOptimisticLockWithGuards(...args),
}))

import * as listRoute from '../route'
import * as matchRoute from '../match/route'
import * as updateRoute from '../[id]/route'

const scope = { tenantId: 'tenant-1', organizationId: 'org-selected' }
const auth = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  orgId: 'org-auth',
}

function partner(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    name: 'Acme',
    taxCode: '0100109106',
    countryCode: 'VN',
    defaultDueDays: 30,
    nameSourceDate: null,
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  }
}

function createRouteHarness(overrides: {
  listPartnersPage?: jest.Mock
  matchPartner?: jest.Mock
  getPartner?: jest.Mock
  updateDefaultDueDays?: jest.Mock
} = {}) {
  const service = {
    listPartnersPage: overrides.listPartnersPage ?? jest.fn(),
    matchPartner: overrides.matchPartner ?? jest.fn(),
    getPartner: overrides.getPartner ?? jest.fn(),
    updateDefaultDueDays: overrides.updateDefaultDueDays ?? jest.fn(),
  }
  const container = {
    resolve: jest.fn((token: string) => {
      if (token === 'invoicePartnerTermsService') return service
      if (token === 'em') return {}
      throw new Error(`Unknown token ${token}`)
    }),
  } as unknown as AwilixContainer

  mockCreateRequestContainer.mockResolvedValue(container)
  mockGetAuthFromRequest.mockResolvedValue(auth)
  mockResolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: scope.organizationId, filterIds: [scope.organizationId] })
  mockResolveTranslations.mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })
  mockRunRouteMutationGuards.mockResolvedValue({
    ok: true,
    runAfterSuccess: jest.fn(),
  })
  mockEnforceCommandOptimisticLockWithGuards.mockResolvedValue(undefined)

  return { container, service }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

describe('invoice partner API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('declares auth and invoice settings ACL metadata for every route', () => {
    expect(listRoute.metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['invoice.settings.manage'] })
    expect(matchRoute.metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['invoice.settings.manage'] })
    expect(updateRoute.metadata.PATCH).toEqual({ requireAuth: true, requireFeatures: ['invoice.settings.manage'] })
  })

  it('exports OpenAPI metadata for every route', () => {
    expect(listRoute.openApi.methods.GET?.operationId).toBe('invoice.partners.list')
    expect(matchRoute.openApi.methods.GET?.operationId).toBe('invoice.partners.match')
    expect(updateRoute.openApi.methods.PATCH?.operationId).toBe('invoice.partners.updateTerms')
  })

  it('lists partners through the service using trusted scope', async () => {
    const { service } = createRouteHarness({
      listPartnersPage: jest.fn().mockResolvedValue({
        items: [partner()],
        total: 1,
        page: 2,
        pageSize: 10,
        totalPages: 1,
      }),
    })
    const response = await listRoute.GET(new Request(
      'https://example.test/api/invoice/partners?page=2&pageSize=10&search=Acme&tenantId=forged&organizationId=forged',
    ))

    expect(response.status).toBe(200)
    expect(service.listPartnersPage).toHaveBeenCalledWith(scope, {
      page: 2,
      pageSize: 10,
      search: 'Acme',
    })
    const body = await readJson(response)
    expect(body.items).toEqual([
      expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Acme',
        defaultDueDays: 30,
        updatedAt: '2026-01-02T00:00:00.000Z',
      }),
    ])
    expect(JSON.stringify(body)).not.toContain('tenant-1')
  })

  it('rejects unauthenticated list requests', async () => {
    createRouteHarness()
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await listRoute.GET(new Request('https://example.test/api/invoice/partners'))

    expect(response.status).toBe(401)
  })

  it('returns 400 when organization context is missing', async () => {
    createRouteHarness()
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: null, filterIds: null })
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: null })

    const response = await listRoute.GET(new Request('https://example.test/api/invoice/partners'))

    expect(response.status).toBe(400)
  })

  it('matches partners through the service', async () => {
    const { service } = createRouteHarness({
      matchPartner: jest.fn().mockResolvedValue(partner()),
    })

    const response = await matchRoute.GET(new Request(
      'https://example.test/api/invoice/partners/match?taxCode=0100109106&name=Acme',
    ))

    expect(response.status).toBe(200)
    expect(service.matchPartner).toHaveBeenCalledWith(scope, {
      taxCode: '0100109106',
      name: 'Acme',
    })
    expect(await readJson(response)).toEqual({
      partner: expect.objectContaining({ taxCode: '0100109106' }),
    })
  })

  it('returns null when no partner matches', async () => {
    createRouteHarness({
      matchPartner: jest.fn().mockResolvedValue(null),
    })

    const response = await matchRoute.GET(new Request('https://example.test/api/invoice/partners/match?name=Missing'))

    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual({ partner: null })
  })

  it('rejects invalid partner update body before loading the partner', async () => {
    const { service } = createRouteHarness()

    const response = await updateRoute.PATCH(
      new Request('https://example.test/api/invoice/partners/11111111-1111-4111-8111-111111111111', {
        method: 'PATCH',
        body: JSON.stringify({ defaultDueDays: 0 }),
      }),
      { params: { id: '11111111-1111-4111-8111-111111111111' } },
    )

    expect(response.status).toBe(400)
    expect(service.getPartner).not.toHaveBeenCalled()
  })

  it('rejects partner identity fields in update body', async () => {
    const { service } = createRouteHarness()

    const response = await updateRoute.PATCH(
      new Request('https://example.test/api/invoice/partners/11111111-1111-4111-8111-111111111111', {
        method: 'PATCH',
        body: JSON.stringify({ defaultDueDays: 30, name: 'Changed' }),
      }),
      { params: { id: '11111111-1111-4111-8111-111111111111' } },
    )

    expect(response.status).toBe(400)
    expect(service.getPartner).not.toHaveBeenCalled()
  })

  it('returns 404 when the scoped partner is unavailable', async () => {
    const { service } = createRouteHarness({
      getPartner: jest.fn().mockResolvedValue(null),
    })

    const response = await updateRoute.PATCH(
      new Request('https://example.test/api/invoice/partners/11111111-1111-4111-8111-111111111111', {
        method: 'PATCH',
        body: JSON.stringify({ defaultDueDays: 30 }),
      }),
      { params: { id: '11111111-1111-4111-8111-111111111111' } },
    )

    expect(response.status).toBe(404)
    expect(service.updateDefaultDueDays).not.toHaveBeenCalled()
  })

  it('enforces optimistic locking and mutation guards before updating payment terms', async () => {
    const current = partner()
    const runAfterSuccess = jest.fn()
    const { container, service } = createRouteHarness({
      getPartner: jest.fn().mockResolvedValue(current),
      updateDefaultDueDays: jest.fn().mockResolvedValue(partner({ defaultDueDays: 45 })),
    })
    mockRunRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess })
    const req = new Request('https://example.test/api/invoice/partners/11111111-1111-4111-8111-111111111111', {
      method: 'PATCH',
      body: JSON.stringify({ defaultDueDays: 45 }),
    })

    const response = await updateRoute.PATCH(req, {
      params: { id: '11111111-1111-4111-8111-111111111111' },
    })

    expect(response.status).toBe(200)
    expect(service.getPartner).toHaveBeenCalledWith(scope, '11111111-1111-4111-8111-111111111111')
    expect(mockEnforceCommandOptimisticLockWithGuards).toHaveBeenCalledWith(container, {
      resourceKind: 'invoice.company',
      resourceId: current.id,
      current: current.updatedAt,
      request: req,
    })
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith({
      container,
      req,
      auth: {
        userId: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'org-selected',
      },
      input: {
        resourceKind: 'invoice.company',
        resourceId: current.id,
        operation: 'update',
        mutationPayload: { defaultDueDays: 45 },
      },
    })
    expect(service.updateDefaultDueDays).toHaveBeenCalledWith(scope, current.id, { defaultDueDays: 45 })
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
    expect(await readJson(response)).toEqual({
      ok: true,
      partner: expect.objectContaining({ defaultDueDays: 45 }),
    })
  })

  it('returns mutation guard block responses', async () => {
    const { service } = createRouteHarness({
      getPartner: jest.fn().mockResolvedValue(partner()),
    })
    mockRunRouteMutationGuards.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'blocked' }, { status: 422 }),
    })

    const response = await updateRoute.PATCH(
      new Request('https://example.test/api/invoice/partners/11111111-1111-4111-8111-111111111111', {
        method: 'PATCH',
        body: JSON.stringify({ defaultDueDays: 30 }),
      }),
      { params: { id: '11111111-1111-4111-8111-111111111111' } },
    )

    expect(response.status).toBe(422)
    expect(service.updateDefaultDueDays).not.toHaveBeenCalled()
  })
})
