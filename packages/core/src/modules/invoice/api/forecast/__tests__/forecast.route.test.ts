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
import type { InvoiceForecastDto } from '../../../data/mappers'

const auth = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  orgId: 'org-auth',
}

const mockForecast: InvoiceForecastDto = {
  currency: 'VND',
  ratesStale: false,
  entries: [
    {
      date: '2026-04-15',
      direction: 'AR',
      amountVnd: '700000.0000',
      invoiceId: '11111111-1111-4111-8111-111111111111',
      installmentId: '22222222-2222-4222-8222-222222222222',
      invoiceNumber: 'INV-1',
      partnerName: 'Buyer',
    },
  ],
  series: [
    {
      date: '2026-04-15',
      arAmount: '700000.0000',
      apAmount: '0.0000',
      netAmount: '700000.0000',
    },
  ],
  totals: {
    arAmount: '700000.0000',
    apAmount: '0.0000',
    netAmount: '700000.0000',
  },
}

function createRouteHarness(overrides: { getForecast?: jest.Mock } = {}) {
  const service = {
    getForecast: overrides.getForecast ?? jest.fn().mockResolvedValue(mockForecast),
  }
  const container = {
    resolve: jest.fn((token: string) => {
      if (token === 'invoiceService') return service
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
  return (await response.json()) as Record<string, unknown>
}

describe('invoice forecast API route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('declares route metadata requiring auth and invoice.view', () => {
    expect(route.metadata.GET).toEqual({
      requireAuth: true,
      requireFeatures: ['invoice.view'],
    })
  })

  it('exports openApi schema for GET /api/invoice/forecast', () => {
    expect(route.openApi.methods.GET).toBeDefined()
    expect(route.openApi.methods.GET?.operationId).toBe('invoice.forecast.get')
  })

  it('returns 200 with forecast dto and parses throughDate query param', async () => {
    const { service } = createRouteHarness()
    const request = new Request('http://localhost/api/invoice/forecast?throughDate=2026-12-31')

    const response = await route.GET(request)

    expect(response.status).toBe(200)
    const body = await readJson(response)
    expect(body).toEqual(mockForecast)
    expect(service.getForecast).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        organizationId: 'org-selected',
      },
      {
        throughDate: '2026-12-31',
      },
    )
  })

  it('returns 401 when authentication is missing', async () => {
    createRouteHarness()
    mockGetAuthFromRequest.mockResolvedValue(null)
    const request = new Request('http://localhost/api/invoice/forecast')

    const response = await route.GET(request)

    expect(response.status).toBe(401)
    const body = await readJson(response)
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 503 when exchange rates are unavailable', async () => {
    createRouteHarness({
      getForecast: jest.fn().mockRejectedValue(new InvoiceExchangeRatesUnavailableError()),
    })
    const request = new Request('http://localhost/api/invoice/forecast')

    const response = await route.GET(request)

    expect(response.status).toBe(503)
    const body = await readJson(response)
    expect(body.error).toBe('Exchange rates are temporarily unavailable')
  })
})

