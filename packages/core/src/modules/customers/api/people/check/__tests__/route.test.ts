/** @jest-environment node */

import { NextResponse } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockCheckPersonIdentity = jest.fn()
const mockResolveTranslations = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockGetRateLimiterService = jest.fn()
const mockCheckRateLimit = jest.fn()

jest.mock('../../../../lib/personLookup', () => ({
  checkPersonIdentity: (...args: unknown[]) => mockCheckPersonIdentity(...args),
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

function post(body: unknown): Request {
  return new Request('http://localhost/api/customers/people/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('customers people check route', () => {
  beforeEach(() => {
    jest.resetModules()
    mockResolveTranslations.mockResolvedValue({ translate: (key: string, fallback?: string) => fallback ?? key })
    mockCreateRequestContainer.mockResolvedValue({ resolve: () => ({ fork: () => ({}) }) })
    mockGetRateLimiterService.mockReturnValue({ trustProxyDepth: 0 })
    mockCheckRateLimit.mockResolvedValue(null)
    mockCheckPersonIdentity.mockReset()
  })

  it('returns existence only, with no customer fields', async () => {
    mockCheckPersonIdentity.mockResolvedValue({ exists: true })

    const { POST } = await import('../route')
    const response = await POST(post({ tenantId: TENANT, phone: '+65 9123 4567' }))

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({ exists: true })
    expect(mockCheckPersonIdentity).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId: TENANT },
      expect.objectContaining({ phone: '+65 9123 4567' }),
    )
  })

  it('does not forward a tenant-scoped organization from the body', async () => {
    mockCheckPersonIdentity.mockResolvedValue({ exists: false })

    const { POST } = await import('../route')
    await POST(post({ tenantId: TENANT, phone: '+6591234567', organizationId: 'attacker-supplied' }))

    expect(mockCheckPersonIdentity).toHaveBeenCalledWith(expect.anything(), { tenantId: TENANT }, expect.anything())
  })

  it('maps identity conflicts to HTTP 409', async () => {
    mockCheckPersonIdentity.mockRejectedValue(
      new CrudHttpError(409, { error: 'Phone and email match different people.', code: 'PERSON_IDENTITY_CONFLICT' }),
    )

    const { POST } = await import('../route')
    const response = await POST(post({ tenantId: TENANT, phone: '+6591234567', email: 'other@example.com' }))

    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('PERSON_IDENTITY_CONFLICT')
  })

  it('rejects a malformed tenant id before touching the database', async () => {
    const { POST } = await import('../route')
    const response = await POST(post({ tenantId: 'not-a-uuid', phone: '+6591234567' }))

    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_INPUT')
    expect(mockCheckPersonIdentity).not.toHaveBeenCalled()
  })

  it('returns the limiter response and never runs the lookup when throttled', async () => {
    mockCheckRateLimit.mockResolvedValue(NextResponse.json({ error: 'Too many requests.' }, { status: 429 }))

    const { POST } = await import('../route')
    const response = await POST(post({ tenantId: TENANT, phone: '+6591234567' }))

    expect(response.status).toBe(429)
    expect(mockCheckPersonIdentity).not.toHaveBeenCalled()
  })

  it('hides internal failures behind a generic 500', async () => {
    mockCheckPersonIdentity.mockRejectedValue(new Error('connection terminated: relation "x" does not exist'))

    const { POST } = await import('../route')
    const response = await POST(post({ tenantId: TENANT, phone: '+6591234567' }))

    expect(response.status).toBe(500)
    const payload = await response.json()
    expect(payload).toEqual({ error: 'Unable to check customer.', code: 'CHECK_FAILED' })
  })
})
