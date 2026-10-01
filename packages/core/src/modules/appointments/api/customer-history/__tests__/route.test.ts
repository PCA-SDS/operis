/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockLookupReturningCustomerForAppointment = jest.fn()
const mockCreateRequestContainer = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('../../../lib/intake', () => ({
  lookupReturningCustomerForAppointment: (...args: unknown[]) => mockLookupReturningCustomerForAppointment(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_ID = '44444444-4444-4444-8444-444444444444'

describe('appointments staff customer history route', () => {
  beforeEach(() => {
    jest.resetModules()
    mockGetAuthFromRequest.mockReset()
    mockLookupReturningCustomerForAppointment.mockReset()
    mockCreateRequestContainer.mockReset()
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: TENANT_ID, orgId: ORGANIZATION_ID, sub: 'staff-user' })
    mockCreateRequestContainer.mockResolvedValue({ resolve: () => ({ fork: () => ({}) }) })
    mockLookupReturningCustomerForAppointment.mockResolvedValue({
      exists: true,
      customer: { id: CUSTOMER_ID, name: 'Subha' },
      lastBooking: {
        organizationId: ORGANIZATION_ID,
        requestedStartAt: '2026-09-01T10:00:00.000Z',
        serviceLines: [{ productId: '11111111-1111-4111-8111-111111111111', selectedOptions: null }],
      },
    })
  })

  it('requires appointment-create permission in route metadata', async () => {
    const { metadata } = await import('../route')
    expect(metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['appointments.create'] })
  })

  it('uses the authenticated tenant without narrowing phone-only history to the selected organization', async () => {
    const { POST } = await import('../route')
    const response = await POST(new Request('http://localhost/api/appointments/customer-history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: ORGANIZATION_ID, phone: '+61 401193184', phoneCountryCode: '61', phoneCountry: 'AU' }),
    }))

    expect(response.status).toBe(200)
    const result = await response.json() as { lastBooking?: { organizationId?: string } | null; customer?: unknown }
    expect(result).toMatchObject({ lastBooking: { organizationId: ORGANIZATION_ID } })
    expect(mockLookupReturningCustomerForAppointment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT_ID, phone: '+61 401193184' }),
    )
    expect(result.customer).toBeUndefined()
  })

  it('rejects requests without an authenticated tenant', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)
    const { POST } = await import('../route')
    const response = await POST(new Request('http://localhost/api/appointments/customer-history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+61 401193184' }),
    }))

    expect(response.status).toBe(401)
    expect(mockLookupReturningCustomerForAppointment).not.toHaveBeenCalled()
  })
})
