/** @jest-environment node */

const mockCheckPersonIdentity = jest.fn()

jest.mock('@open-mercato/core/modules/customers/lib/personLookup', () => ({
  checkPersonIdentity: (...args: unknown[]) => mockCheckPersonIdentity(...args),
}))

describe('lookupReturningCustomerForAppointment', () => {
  const tenantId = '22222222-2222-4222-8222-222222222222'
  const selectedOrganizationId = '33333333-3333-4333-8333-333333333333'
  const latestOrganizationId = '44444444-4444-4444-8444-444444444444'
  const customerEntityId = '55555555-5555-4555-8555-555555555555'

  beforeEach(() => {
    jest.resetModules()
    mockCheckPersonIdentity.mockReset()
    mockCheckPersonIdentity.mockResolvedValue({
      exists: true,
      customer: { id: customerEntityId, name: 'Tenant-wide customer' },
      lastBooking: null,
    })
  })

  it('selects the latest booking by tenant and customer without an organization filter', async () => {
    const findOne = jest.fn().mockResolvedValue({
      organizationId: latestOrganizationId,
      requestedStartAt: new Date('2026-10-01T04:15:00.000Z'),
      lines: { getItems: () => [] },
    })
    const { lookupReturningCustomerForAppointment } = await import('../intake')

    const result = await lookupReturningCustomerForAppointment(
      { findOne } as never,
      {
        tenantId,
        organizationId: selectedOrganizationId,
        phone: '+84 901 234 567',
      },
    )

    expect(findOne).toHaveBeenCalledWith(
      expect.anything(),
      {
        tenantId,
        customerEntityId,
        deletedAt: null,
      },
      {
        orderBy: { requestedStartAt: 'DESC' },
        populate: ['lines'],
      },
    )
    expect(result.lastBooking?.organizationId).toBe(latestOrganizationId)
  })

  it('scopes the latest-booking query to the authenticated tenant', async () => {
    const findOne = jest.fn().mockResolvedValue(null)
    const { lookupReturningCustomerForAppointment } = await import('../intake')

    const result = await lookupReturningCustomerForAppointment(
      { findOne } as never,
      {
        tenantId,
        organizationId: selectedOrganizationId,
        phone: '+84 901 234 567',
      },
    )

    expect(findOne).toHaveBeenCalledWith(
      expect.anything(),
      {
        tenantId,
        customerEntityId,
        deletedAt: null,
      },
      expect.objectContaining({ orderBy: { requestedStartAt: 'DESC' } }),
    )
    expect(result.lastBooking).toBeNull()
  })
})
