import type { AwilixContainer } from 'awilix'
import { NextResponse } from 'next/server'

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockResolveTranslations = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockGetCachedRateLimiterService = jest.fn()
const mockCheckRateLimit = jest.fn()

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

jest.mock('@open-mercato/core/bootstrap', () => ({
  getCachedRateLimiterService: (...args: unknown[]) => mockGetCachedRateLimiterService(...args),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  RATE_LIMIT_ERROR_FALLBACK: 'Too many requests. Please try again later.',
  RATE_LIMIT_ERROR_KEY: 'api.errors.rateLimit',
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

import * as route from '../route'
import { InvoiceCompanyLookupUnavailableError } from '../../../../services/company-lookup-service'

const scope = { tenantId: 'tenant-1', organizationId: 'org-selected' }
const auth = {
  sub: 'user-1',
  tenantId: scope.tenantId,
  orgId: 'org-auth',
}
const lookupResult = {
  mode: 'registry',
  countryCode: 'VN',
  identifier: '0100109106',
  provider: 'vietqr',
  fetchedAt: '2026-09-07T00:00:00.000Z',
  stale: false,
  company: {
    name: 'Acme Vietnam',
    registrationNumber: '0100109106',
    taxCode: '0100109106',
    address: null,
    status: 'ACTIVE',
    sourceUpdatedAt: null,
  },
}

function createRouteHarness(overrides: { lookup?: jest.Mock } = {}) {
  const service = {
    lookup: overrides.lookup ?? jest.fn().mockResolvedValue(lookupResult),
  }
  const container = {
    resolve: jest.fn((token: string) => {
      if (token === 'invoiceCompanyLookupService') return service
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
  mockGetCachedRateLimiterService.mockReturnValue({ consume: jest.fn() })
  mockCheckRateLimit.mockResolvedValue(null)

  return { container, service }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

describe('invoice company lookup API route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('declares auth and invoice view ACL metadata', () => {
    expect(route.metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['invoice.view'] })
  })

  it('exports OpenAPI metadata', () => {
    expect(route.openApi.methods.GET?.operationId).toBe('invoice.companyLookup.get')
    expect(route.openApi.methods.GET?.errors?.some((error) => error.status === 429)).toBe(true)
    expect(route.openApi.methods.GET?.errors?.some((error) => error.status === 503)).toBe(true)
  })

  it('returns lookup results through the service using trusted scope', async () => {
    const { service } = createRouteHarness()
    const req = new Request('https://example.test/api/invoice/company-lookup/0100109106?country=VN&tenantId=forged')

    const response = await route.GET(req, { params: { identifier: '0100109106' } })

    expect(response.status).toBe(200)
    expect(service.lookup).toHaveBeenCalledWith(scope, { country: 'VN', identifier: '0100109106' })
    expect(await readJson(response)).toEqual(lookupResult)
  })

  it('defaults country to Vietnam', async () => {
    const { service } = createRouteHarness()

    await route.GET(new Request('https://example.test/api/invoice/company-lookup/0100109106'), {
      params: { identifier: '0100109106' },
    })

    expect(service.lookup).toHaveBeenCalledWith(scope, { country: 'VN', identifier: '0100109106' })
  })

  it('rejects unauthenticated requests', async () => {
    createRouteHarness()
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await route.GET(new Request('https://example.test/api/invoice/company-lookup/0100109106'), {
      params: { identifier: '0100109106' },
    })

    expect(response.status).toBe(401)
  })

  it('applies a fail-closed rate limit before lookup', async () => {
    const { service } = createRouteHarness()
    mockCheckRateLimit.mockResolvedValue(NextResponse.json({ error: 'Too many requests' }, { status: 429 }))

    const response = await route.GET(new Request('https://example.test/api/invoice/company-lookup/0100109106'), {
      params: { identifier: '0100109106' },
    })

    expect(response.status).toBe(429)
    expect(service.lookup).not.toHaveBeenCalled()
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ keyPrefix: 'invoice_company_lookup' }),
      'tenant-1:user-1',
      'Too many requests. Please try again later.',
      expect.objectContaining({ failClosed: true }),
    )
  })

  it('returns 503 when lookup has no usable provider or cache result', async () => {
    createRouteHarness({
      lookup: jest.fn().mockRejectedValue(new InvoiceCompanyLookupUnavailableError()),
    })

    const response = await route.GET(new Request('https://example.test/api/invoice/company-lookup/0100109106'), {
      params: { identifier: '0100109106' },
    })

    expect(response.status).toBe(503)
    expect(await readJson(response)).toEqual({
      error: 'Company lookup is temporarily unavailable',
    })
  })
})
