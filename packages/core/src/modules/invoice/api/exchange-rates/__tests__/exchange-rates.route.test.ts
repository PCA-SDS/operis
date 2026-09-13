import type { AwilixContainer } from 'awilix'

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockResolveTranslations = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()

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

import * as route from '../route'
import { InvoiceExchangeRatesUnavailableError } from '../../../services/exchange-rates-service'

const auth = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  orgId: 'org-auth',
}

const rates = {
  baseCurrency: 'VND',
  fetchedAt: '2026-01-01T00:00:00.000Z',
  stale: false,
  rates: {
    USD: { currencyCode: 'USD', vndPerUnit: 25000 },
    EUR: { currencyCode: 'EUR', vndPerUnit: 31250 },
    GBP: { currencyCode: 'GBP', vndPerUnit: 35714.28571428572 },
    SGD: { currencyCode: 'SGD', vndPerUnit: 19230.76923076923 },
    AUD: { currencyCode: 'AUD', vndPerUnit: 16666.666666666668 },
    JPY: { currencyCode: 'JPY', vndPerUnit: 166.66666666666666 },
    CNY: { currencyCode: 'CNY', vndPerUnit: 3571.4285714285716 },
    KRW: { currencyCode: 'KRW', vndPerUnit: 19.23076923076923 },
    THB: { currencyCode: 'THB', vndPerUnit: 714.2857142857143 },
    VND: { currencyCode: 'VND', vndPerUnit: 1 },
  },
}

function createRouteHarness(overrides: { getRates?: jest.Mock } = {}) {
  const service = {
    getRates: overrides.getRates ?? jest.fn().mockResolvedValue(rates),
  }
  const container = {
    resolve: jest.fn((token: string) => {
      if (token === 'invoiceExchangeRatesService') return service
      if (token === 'em') return {}
      throw new Error(`Unknown token ${token}`)
    }),
  } as unknown as AwilixContainer

  mockCreateRequestContainer.mockResolvedValue(container)
  mockGetAuthFromRequest.mockResolvedValue(auth)
  mockResolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: 'org-selected', filterIds: ['org-selected'] })
  mockResolveTranslations.mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })

  return { container, service }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

describe('invoice exchange rates API route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('declares auth and invoice view ACL metadata', () => {
    expect(route.metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['invoice.view'] })
  })

  it('exports OpenAPI metadata', () => {
    expect(route.openApi.methods.GET?.operationId).toBe('invoice.exchangeRates.get')
    expect(route.openApi.methods.GET?.errors?.some((error) => error.status === 503)).toBe(true)
  })

  it('returns exchange rates through the service', async () => {
    const { service } = createRouteHarness()

    const response = await route.GET(new Request('https://example.test/api/invoice/exchange-rates'))

    expect(response.status).toBe(200)
    expect(service.getRates).toHaveBeenCalledTimes(1)
    expect(await readJson(response)).toEqual(rates)
  })

  it('rejects unauthenticated requests', async () => {
    createRouteHarness()
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await route.GET(new Request('https://example.test/api/invoice/exchange-rates'))

    expect(response.status).toBe(401)
  })

  it('returns 400 when organization context is missing', async () => {
    createRouteHarness()
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: null, filterIds: null })
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: null })

    const response = await route.GET(new Request('https://example.test/api/invoice/exchange-rates'))

    expect(response.status).toBe(400)
  })

  it('maps provider unavailability without cache to 503', async () => {
    createRouteHarness({
      getRates: jest.fn().mockRejectedValue(new InvoiceExchangeRatesUnavailableError()),
    })

    const response = await route.GET(new Request('https://example.test/api/invoice/exchange-rates'))

    expect(response.status).toBe(503)
    expect(await readJson(response)).toEqual({
      error: 'Exchange rates are temporarily unavailable',
    })
  })
})
