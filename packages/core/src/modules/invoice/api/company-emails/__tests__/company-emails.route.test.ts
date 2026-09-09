import type { AwilixContainer } from 'awilix'

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockResolveTranslations = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockRunRouteMutationGuards = jest.fn()

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

import * as listRecordRoute from '../route'
import * as deleteRoute from '../[id]/route'

const scope = { tenantId: 'tenant-1', organizationId: 'org-selected' }
const auth = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  orgId: 'org-auth',
}
const companyId = '11111111-1111-4111-8111-111111111111'
const emailId = '22222222-2222-4222-8222-222222222222'

function companyEmail(overrides: Record<string, unknown> = {}) {
  return {
    id: emailId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    company: { id: companyId },
    email: 'billing@example.com',
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  }
}

function createRouteHarness(overrides: {
  listByCompany?: jest.Mock
  record?: jest.Mock
  remove?: jest.Mock
} = {}) {
  const service = {
    listByCompany: overrides.listByCompany ?? jest.fn(),
    record: overrides.record ?? jest.fn(),
    remove: overrides.remove ?? jest.fn(),
  }
  const container = {
    resolve: jest.fn((token: string) => {
      if (token === 'invoiceCompanyEmailsService') return service
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

  return { container, service }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

describe('invoice company email API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('declares auth and invoice manage ACL metadata for every route', () => {
    expect(listRecordRoute.metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['invoice.manage'] })
    expect(listRecordRoute.metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['invoice.manage'] })
    expect(deleteRoute.metadata.DELETE).toEqual({ requireAuth: true, requireFeatures: ['invoice.manage'] })
  })

  it('exports OpenAPI metadata for every route', () => {
    expect(listRecordRoute.openApi.methods.GET?.operationId).toBe('invoice.companyEmails.list')
    expect(listRecordRoute.openApi.methods.POST?.operationId).toBe('invoice.companyEmails.record')
    expect(deleteRoute.openApi.methods.DELETE?.operationId).toBe('invoice.companyEmails.remove')
  })

  it('lists company emails through the service using trusted scope', async () => {
    const { service } = createRouteHarness({
      listByCompany: jest.fn().mockResolvedValue([companyEmail()]),
    })

    const response = await listRecordRoute.GET(new Request(
      `https://example.test/api/invoice/company-emails?companyId=${companyId}&tenantId=forged&organizationId=forged`,
    ))

    expect(response.status).toBe(200)
    expect(service.listByCompany).toHaveBeenCalledWith(scope, companyId)
    expect(await readJson(response)).toEqual({
      items: [
        {
          id: emailId,
          companyId,
          email: 'billing@example.com',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    })
  })

  it('rejects unauthenticated list requests', async () => {
    createRouteHarness()
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await listRecordRoute.GET(new Request(
      `https://example.test/api/invoice/company-emails?companyId=${companyId}`,
    ))

    expect(response.status).toBe(401)
  })

  it('returns 400 when organization context is missing', async () => {
    createRouteHarness()
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: null, filterIds: null })
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: null })

    const response = await listRecordRoute.GET(new Request(
      `https://example.test/api/invoice/company-emails?companyId=${companyId}`,
    ))

    expect(response.status).toBe(400)
  })

  it('rejects invalid list query before resolving the service', async () => {
    const { service } = createRouteHarness()

    const response = await listRecordRoute.GET(new Request('https://example.test/api/invoice/company-emails'))

    expect(response.status).toBe(400)
    expect(service.listByCompany).not.toHaveBeenCalled()
  })

  it('records company emails through mutation guards', async () => {
    const runAfterSuccess = jest.fn()
    const { container, service } = createRouteHarness({
      record: jest.fn().mockResolvedValue(companyEmail({ email: 'Billing@Example.com' })),
    })
    mockRunRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess })
    const req = new Request('https://example.test/api/invoice/company-emails', {
      method: 'POST',
      body: JSON.stringify({ companyId, email: '  Billing@Example.com  ' }),
    })

    const response = await listRecordRoute.POST(req)

    expect(response.status).toBe(200)
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith({
      container,
      req,
      auth: {
        userId: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'org-selected',
      },
      input: {
        resourceKind: 'invoice.company_email',
        resourceId: companyId,
        operation: 'create',
        mutationPayload: { companyId, email: 'Billing@Example.com' },
      },
    })
    expect(service.record).toHaveBeenCalledWith(scope, { companyId, email: 'Billing@Example.com' })
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
    expect(await readJson(response)).toEqual({
      ok: true,
      email: expect.objectContaining({
        companyId,
        email: 'Billing@Example.com',
      }),
    })
  })

  it('returns mutation guard block responses for record', async () => {
    const { service } = createRouteHarness()
    mockRunRouteMutationGuards.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'blocked' }, { status: 422 }),
    })

    const response = await listRecordRoute.POST(new Request('https://example.test/api/invoice/company-emails', {
      method: 'POST',
      body: JSON.stringify({ companyId, email: 'billing@example.com' }),
    }))

    expect(response.status).toBe(422)
    expect(service.record).not.toHaveBeenCalled()
  })

  it('removes company emails through mutation guards', async () => {
    const runAfterSuccess = jest.fn()
    const { container, service } = createRouteHarness({
      remove: jest.fn().mockResolvedValue(undefined),
    })
    mockRunRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess })
    const req = new Request(`https://example.test/api/invoice/company-emails/${emailId}?companyId=${companyId}`, {
      method: 'DELETE',
    })

    const response = await deleteRoute.DELETE(req, { params: { id: emailId } })

    expect(response.status).toBe(200)
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith({
      container,
      req,
      auth: {
        userId: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'org-selected',
      },
      input: {
        resourceKind: 'invoice.company_email',
        resourceId: emailId,
        operation: 'delete',
        mutationPayload: { companyId },
      },
    })
    expect(service.remove).toHaveBeenCalledWith(scope, { companyId, id: emailId })
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
    expect(await readJson(response)).toEqual({ ok: true })
  })

  it('rejects invalid delete query before removing', async () => {
    const { service } = createRouteHarness()

    const response = await deleteRoute.DELETE(
      new Request(`https://example.test/api/invoice/company-emails/${emailId}`, { method: 'DELETE' }),
      { params: { id: emailId } },
    )

    expect(response.status).toBe(400)
    expect(service.remove).not.toHaveBeenCalled()
  })
})
