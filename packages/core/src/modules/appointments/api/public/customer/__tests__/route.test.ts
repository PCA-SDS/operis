/** @jest-environment node */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockGetRateLimiterService = jest.fn()
const mockCheckRateLimit = jest.fn()
const mockLookupPublicCustomerForAppointment = jest.fn()
const mockResolveTranslations = jest.fn()
const mockCreateRequestContainer = jest.fn()

jest.mock('@open-mercato/core/bootstrap', () => ({
  getCachedRateLimiterService: (...args: unknown[]) => mockGetRateLimiterService(...args),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/ratelimit/helpers')
  return { ...actual, checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args) }
})

jest.mock('../../../../lib/intake', () => ({
  lookupPublicCustomerForAppointment: (...args: unknown[]) => mockLookupPublicCustomerForAppointment(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => mockResolveTranslations(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

const validBody = {
  tenantId: '22222222-2222-4222-8222-222222222222',
  phone: '+84901234567',
  email: 'ada@example.com',
  phoneCountryCode: '+84',
  phoneCountry: 'vn',
}

describe('appointments public customer lookup route', () => {
  beforeEach(() => {
    jest.resetModules()
    mockResolveTranslations.mockResolvedValue({
      translate: (_key: string, fallback?: string) => fallback ?? _key,
    })
    mockCreateRequestContainer.mockResolvedValue({ resolve: () => ({ fork: () => ({}) }) })
    mockGetRateLimiterService.mockReturnValue({ trustProxyDepth: 0 })
    mockCheckRateLimit.mockResolvedValue(null)
    mockLookupPublicCustomerForAppointment.mockReset()
  })

  it('returns the customer and latest appointment lines', async () => {
    mockLookupPublicCustomerForAppointment.mockResolvedValue({
      exists: true,
      customer: {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Ada Lovelace',
        salutation: 'Ms',
        email: 'ada@example.com',
        phone: '+84901234567',
        phoneCountryCode: '+84',
        phoneCountry: 'vn',
        source: 'instagram',
        origin: 'tourist',
        organizationId: '33333333-3333-4333-8333-333333333333',
      },
      lastBooking: {
        organizationId: '33333333-3333-4333-8333-333333333333',
        requestedStartAt: '2026-09-01T10:00:00.000Z',
        serviceLines: [{ productId: '11111111-1111-4111-8111-111111111111', selectedOptions: {} }],
      },
    })

    const { POST } = await import('../route')
    const response = await POST(
      new Request('http://localhost/api/appointments/public/customer', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3001' },
        body: JSON.stringify(validBody),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ exists: true, lastBooking: expect.any(Object) })
    expect(mockLookupPublicCustomerForAppointment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: validBody.tenantId, email: validBody.email }),
    )
  })

  it('maps identity conflicts to HTTP 409', async () => {
    mockLookupPublicCustomerForAppointment.mockRejectedValue(
      new CrudHttpError(409, { error: 'Phone and email match different people.', code: 'PERSON_IDENTITY_CONFLICT' }),
    )

    const { POST } = await import('../route')
    const response = await POST(
      new Request('http://localhost/api/appointments/public/customer', {
        method: 'POST',
        body: JSON.stringify(validBody),
      }),
    )

    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('PERSON_IDENTITY_CONFLICT')
  })

  it('rejects malformed input before touching the database', async () => {
    const { POST } = await import('../route')
    const response = await POST(
      new Request('http://localhost/api/appointments/public/customer', {
        method: 'POST',
        body: JSON.stringify({ ...validBody, tenantId: 'invalid' }),
      }),
    )

    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_INPUT')
    expect(mockLookupPublicCustomerForAppointment).not.toHaveBeenCalled()
  })
})
