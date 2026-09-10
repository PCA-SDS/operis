import { NextResponse } from 'next/server'

const mockCreateRequestContainer = jest.fn()
const mockGetCachedRateLimiterService = jest.fn()
const mockCheckRateLimit = jest.fn()
const mockGetClientIp = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))
jest.mock('@open-mercato/core/bootstrap', () => ({
  getCachedRateLimiterService: (...args: unknown[]) => mockGetCachedRateLimiterService(...args),
}))
jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
  RATE_LIMIT_FALLBACK_KEY: 'fallback',
  RATE_LIMIT_ERROR_FALLBACK: 'Too many requests',
}))

import * as route from '../route'

const token = 'a'.repeat(64)
const preview = {
  status: 'PENDING',
  expiresAt: '2026-10-01T00:00:00.000Z',
  payerName: 'Buyer',
  payeeName: 'Supplier',
  invoice: { symbol: 'INV', number: '1001', amount: '10.0000', currencyCode: 'USD' },
  installment: null,
}

describe('public payment confirmation routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCachedRateLimiterService.mockReturnValue({ trustProxyDepth: 0 })
    mockGetClientIp.mockReturnValue('127.0.0.1')
    mockCheckRateLimit.mockResolvedValue(null)
    mockCreateRequestContainer.mockResolvedValue({
      resolve: jest.fn(() => ({ getPublicPreview: jest.fn().mockResolvedValue(preview) })),
    })
  })

  it('is anonymous and exports public OpenAPI metadata', () => {
    expect(route.metadata.GET).toEqual({ requireAuth: false })
    expect(route.openApi.methods.GET?.errors?.some((error) => error.status === 429)).toBe(true)
  })

  it('returns 404 for malformed tokens before container lookup', async () => {
    const response = await route.GET(new Request('https://example.test'), { params: { token: 'bad' } })
    expect(response.status).toBe(404)
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
  })

  it('applies the public limiter and returns the safe preview', async () => {
    const response = await route.GET(new Request('https://example.test'), { params: { token } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(preview)
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ keyPrefix: 'invoice_payment_confirmation_public' }),
      '127.0.0.1',
      'Too many requests',
    )
  })

  it('returns the limiter response without resolving the service', async () => {
    mockCheckRateLimit.mockResolvedValue(NextResponse.json({ error: 'Too many requests' }, { status: 429 }))
    const response = await route.GET(new Request('https://example.test'), { params: { token } })
    expect(response.status).toBe(429)
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
  })
})
