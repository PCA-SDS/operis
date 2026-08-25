/** @jest-environment node */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockCheckPersonIdentity = jest.fn()
const mockResolveTranslations = jest.fn()
const mockCreateRequestContainer = jest.fn()

jest.mock('../../../../lib/personLookup', () => ({
  checkPersonIdentity: (...args: unknown[]) => mockCheckPersonIdentity(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => mockResolveTranslations(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

describe('customers people check route', () => {
  beforeEach(() => {
    jest.resetModules()
    mockResolveTranslations.mockResolvedValue({ translate: (_key: string, fallback?: string) => fallback ?? _key })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: () => ({ fork: () => ({}) }),
    })
    mockCheckPersonIdentity.mockReset()
  })

  it('returns lookup payload for valid scoped requests', async () => {
    mockCheckPersonIdentity.mockResolvedValue({
      exists: true,
      customer: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Ada Lovelace',
        salutation: 'Dr',
        email: 'ada@example.com',
        phone: '+65 9123 4567',
        phoneCountryCode: '65',
        phoneCountry: 'sg',
        source: 'booking_form',
      },
      lastBooking: null,
    })

    const { POST } = await import('../route')
    const response = await POST(
      new Request('http://localhost/api/customers/people/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: '22222222-2222-4222-8222-222222222222',
          organizationId: '33333333-3333-4333-8333-333333333333',
          phone: '+65 9123 4567',
        }),
      }),
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.exists).toBe(true)
    expect(payload.lastBooking).toBeNull()
    expect(payload.customer.name).toBe('Ada Lovelace')
  })

  it('maps identity conflicts to HTTP 409', async () => {
    mockCheckPersonIdentity.mockRejectedValue(
      new CrudHttpError(409, { error: 'Phone and email match different people.', code: 'PERSON_IDENTITY_CONFLICT' }),
    )

    const { POST } = await import('../route')
    const response = await POST(
      new Request('http://localhost/api/customers/people/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: '22222222-2222-4222-8222-222222222222',
          organizationId: '33333333-3333-4333-8333-333333333333',
          phone: '+65 9123 4567',
          email: 'other@example.com',
        }),
      }),
    )

    expect(response.status).toBe(409)
    const payload = await response.json()
    expect(payload.code).toBe('PERSON_IDENTITY_CONFLICT')
  })
})
