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
import type { InvoiceSummaryDto } from '../../../data/mappers'

const auth = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  orgId: 'org-auth',
}

const mockSummary: InvoiceSummaryDto = {
  currency: 'VND',
  ar: {
    outstanding: '1000000.0000',
    settled: '500000.0000',
    net: '1000000.0000',
    total: '1500000.0000',
    outstandingAmount: '1000000.0000',
    settledAmount: '500000.0000',
    totalAmount: '1500000.0000',
    nonRecoverableAmount: '0.0000',
  },
  ap: {
    outstanding: '400000.0000',
    settled: '200000.0000',
    net: '400000.0000',
    total: '600000.0000',
    outstandingAmount: '400000.0000',
    settledAmount: '200000.0000',
    totalAmount: '600000.0000',
  },
  netPosition: '600000.0000',
  net: '600000.0000',
  netOutstanding: '600000.0000',
  ratesStale: false,
}

function createRouteHarness(overrides: { getSummary?: jest.Mock } = {}) {
  const service = {
    getSummary: overrides.getSummary ?? jest.fn().mockResolvedValue(mockSummary),
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

describe('invoice summary API route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('declares route metadata requiring auth and invoice.view', () => {
    expect(route.metadata.GET).toEqual({
      requireAuth: true,
      requireFeatures: ['invoice.view'],
    })
  })

  it('exports openApi schema for GET /api/invoice/summary', () => {
    expect(route.openApi.methods.GET).toBeDefined()
    expect(route.openApi.methods.GET?.operationId).toBe('invoice.summary.get')
  })

  it('returns 200 with summary dto when request succeeds', async () => {
    const { service } = createRouteHarness()
    const request = new Request('http://localhost/api/invoice/summary')

    const response = await route.GET(request)

    expect(response.status).toBe(200)
    const body = await readJson(response)
    expect(body).toEqual(mockSummary)
    expect(service.getSummary).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      organizationId: 'org-selected',
    })
  })

  it('returns 401 when authentication is missing', async () => {
    createRouteHarness()
    mockGetAuthFromRequest.mockResolvedValue(null)
    const request = new Request('http://localhost/api/invoice/summary')

    const response = await route.GET(request)

    expect(response.status).toBe(401)
    const body = await readJson(response)
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 503 when exchange rates are unavailable', async () => {
    createRouteHarness({
      getSummary: jest.fn().mockRejectedValue(new InvoiceExchangeRatesUnavailableError()),
    })
    const request = new Request('http://localhost/api/invoice/summary')

    const response = await route.GET(request)

    expect(response.status).toBe(503)
    const body = await readJson(response)
    expect(body.error).toBe('Exchange rates are temporarily unavailable')
  })
})

