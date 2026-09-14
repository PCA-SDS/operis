import type { AwilixContainer } from 'awilix'

const mockCreateRequestContainer = jest.fn()
const mockGetCachedRateLimiterService = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))
jest.mock('@open-mercato/core/bootstrap', () => ({
  getCachedRateLimiterService: (...args: unknown[]) => mockGetCachedRateLimiterService(...args),
}))

import * as pixelRoute from '../[token]/pixel.gif/route'

const token = 'a'.repeat(64)

describe('invoice tracking pixel route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCachedRateLimiterService.mockReturnValue(null)
  })

  it('is public and documents a GIF response', () => {
    expect(pixelRoute.metadata.GET).toEqual({ requireAuth: false })
    expect(pixelRoute.openApi.methods.GET?.operationId).toBe('invoice.invoiceTracking.pixel')
  })

  it('returns the same transparent GIF for invalid tokens without touching the database', async () => {
    const response = await pixelRoute.GET(new Request('https://example.test/api/invoice/track/not-valid/pixel.gif'), {
      params: { token: 'not-valid' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/gif')
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
  })

  it('swallows tracking failures and still returns the GIF', async () => {
    const trackingService = { recordOpen: jest.fn().mockRejectedValue(new Error('database unavailable')) }
    const container = { resolve: jest.fn().mockReturnValue(trackingService) } as unknown as AwilixContainer
    mockCreateRequestContainer.mockResolvedValue(container)

    const response = await pixelRoute.GET(new Request(`https://example.test/api/invoice/track/${token}/pixel.gif`), {
      params: { token },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(trackingService.recordOpen).toHaveBeenCalled()
  })
})
