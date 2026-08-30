/** @jest-environment node */

import { NextResponse } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockListBookableServicesForOrganization = jest.fn()
const mockResolveTranslations = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockGetRateLimiterService = jest.fn()
const mockCheckRateLimit = jest.fn()

jest.mock('../../../lib/bookableServices', () => ({
  listBookableServicesForOrganization: (...args: unknown[]) =>
    mockListBookableServicesForOrganization(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => mockResolveTranslations(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/core/bootstrap', () => ({
  getCachedRateLimiterService: (...args: unknown[]) => mockGetRateLimiterService(...args),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/ratelimit/helpers')
  return {
    ...actual,
    checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  }
})

const TENANT = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'

const pricingService = { resolvePrice: jest.fn(), resolvePriceMany: jest.fn() }

function get(query = `?tenantId=${TENANT}&organizationId=${ORG}`): Request {
  return new Request(`http://localhost/api/catalog/bookable-services${query}`)
}

describe('catalog bookable-services route', () => {
  beforeEach(() => {
    jest.resetModules()
    mockResolveTranslations.mockResolvedValue({
      translate: (key: string, fallback?: string) => fallback ?? key,
    })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: (token: string) =>
        token === 'catalogPricingService' ? pricingService : { fork: () => ({}) },
    })
    mockGetRateLimiterService.mockReturnValue({ trustProxyDepth: 0 })
    mockCheckRateLimit.mockResolvedValue(null)
    mockListBookableServicesForOrganization.mockReset()
  })

  it('returns org-scoped bookable services for valid query', async () => {
    mockListBookableServicesForOrganization.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Signature Haircut',
        subtitle: null,
        description: null,
        handle: 'signature-haircut-service',
        currencyCode: 'USD',
        unitPriceNet: '95.0000',
        unitPriceGross: '95.0000',
        durationMinutes: 60,
        organizationId: ORG,
        tenantId: TENANT,
      },
    ])

    const { GET } = await import('../route')
    const response = await GET(get())

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0].title).toBe('Signature Haircut')
    expect(mockListBookableServicesForOrganization).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId: TENANT, organizationId: ORG },
      { pricingService },
    )
  })

  it('maps missing tenant/org to HTTP 404', async () => {
    mockListBookableServicesForOrganization.mockRejectedValue(
      new CrudHttpError(404, { error: 'Organization not found.', code: 'ORGANIZATION_NOT_FOUND' }),
    )

    const { GET } = await import('../route')
    const response = await GET(get())

    expect(response.status).toBe(404)
    const payload = await response.json()
    expect(payload.code).toBe('ORGANIZATION_NOT_FOUND')
  })

  it('rejects missing query params with HTTP 400', async () => {
    const { GET } = await import('../route')
    const response = await GET(get(''))
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.code).toBe('INVALID_INPUT')
    expect(mockListBookableServicesForOrganization).not.toHaveBeenCalled()
  })

  it('rejects a malformed scope before touching the database', async () => {
    const { GET } = await import('../route')
    const response = await GET(get(`?tenantId=not-a-uuid&organizationId=${ORG}`))
    expect(response.status).toBe(400)
    expect(mockListBookableServicesForOrganization).not.toHaveBeenCalled()
  })

  it('returns the limiter response and never runs the listing when throttled', async () => {
    mockCheckRateLimit.mockResolvedValue(NextResponse.json({ error: 'Too many requests.' }, { status: 429 }))

    const { GET } = await import('../route')
    const response = await GET(get())

    expect(response.status).toBe(429)
    expect(mockListBookableServicesForOrganization).not.toHaveBeenCalled()
  })

  it('hides internal failures behind a generic 500', async () => {
    mockListBookableServicesForOrganization.mockRejectedValue(
      new Error('connection terminated: relation "x" does not exist'),
    )

    const { GET } = await import('../route')
    const response = await GET(get())

    expect(response.status).toBe(500)
    const payload = await response.json()
    expect(payload).toEqual({ error: 'Unable to list bookable services.', code: 'LIST_FAILED' })
  })
})
