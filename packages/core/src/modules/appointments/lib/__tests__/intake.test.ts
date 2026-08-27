/** @jest-environment node */

const mockFindOrCreatePersonForIntake = jest.fn()
const mockListBookableServicesForOrganization = jest.fn()
const mockEnsureSystemAppointmentStatuses = jest.fn()

jest.mock('@open-mercato/core/modules/customers/lib/personLookup', () => ({
  findOrCreatePersonForIntake: (...args: unknown[]) => mockFindOrCreatePersonForIntake(...args),
}))

jest.mock('@open-mercato/core/modules/catalog/lib/bookableServices', () => ({
  listBookableServicesForOrganization: (...args: unknown[]) =>
    mockListBookableServicesForOrganization(...args),
}))

jest.mock('../../setup', () => ({
  ensureSystemAppointmentStatuses: (...args: unknown[]) => mockEnsureSystemAppointmentStatuses(...args),
}))

describe('createAppointmentFromPublicIntake', () => {
  const tenantId = '22222222-2222-4222-8222-222222222222'
  const organizationId = '33333333-3333-4333-8333-333333333333'
  const productId = '11111111-1111-4111-8111-111111111111'
  const customerEntityId = '44444444-4444-4444-8444-444444444444'

  const persisted: unknown[] = []
  const em = {
    findOne: jest.fn(),
    create: jest.fn((_Entity: unknown, data: Record<string, unknown>) => ({
      id: '55555555-5555-4555-8555-555555555555',
      ...data,
    })),
    persist: jest.fn((entity: unknown) => {
      persisted.push(entity)
      return entity
    }),
    flush: jest.fn(),
  }

  beforeEach(() => {
    jest.resetModules()
    persisted.length = 0
    mockFindOrCreatePersonForIntake.mockReset()
    mockListBookableServicesForOrganization.mockReset()
    mockEnsureSystemAppointmentStatuses.mockReset()
    em.findOne.mockReset()
    em.create.mockClear()
    em.persist.mockClear()
    em.flush.mockClear()

    mockFindOrCreatePersonForIntake.mockResolvedValue({
      entityId: customerEntityId,
      personId: customerEntityId,
      created: true,
    })
    mockListBookableServicesForOrganization.mockResolvedValue([
      {
        id: productId,
        title: 'Signature Haircut',
        handle: 'signature-haircut',
        currencyCode: 'USD',
        unitPriceNet: '95.0000',
        unitPriceGross: '95.0000',
        durationMinutes: 60,
      },
    ])
    mockEnsureSystemAppointmentStatuses.mockResolvedValue(undefined)
    em.findOne.mockResolvedValue({
      id: '66666666-6666-4666-8666-666666666666',
      code: 'new_request',
    })
  })

  it('creates appointment with customer + line snapshots and new_request status', async () => {
    const { createAppointmentFromPublicIntake } = await import('../intake')
    const result = await createAppointmentFromPublicIntake(em as never, {
      tenantId,
      organizationId,
      requestedStartAt: '2026-09-01T10:00:00.000Z',
      bookingType: 'walk_in',
      externalNotes: 'Guest prefers quiet room',
      customer: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '+15551212',
        email: 'ada@example.com',
        source: 'linkedin',
        origin: 'local',
        phoneCountryCode: '+1',
      },
      lines: [{ productId }],
    })

    expect(result.statusCode).toBe('new_request')
    expect(result.customerEntityId).toBe(customerEntityId)
    expect(result.customerCreated).toBe(true)
    expect(result.lineCount).toBe(1)
    expect(result.requestedEndAt).toBe('2026-09-01T11:00:00.000Z')
    expect(mockFindOrCreatePersonForIntake).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: 'linkedin', origin: 'local', phoneCountryCode: '+1' }),
    )
    expect(em.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        customerOrigin: 'local',
        bookingType: 'walk_in',
        externalNotes: 'Guest prefers quiet room',
        customerPhone: '5551212',
        customerPhoneCountryCode: '+1',
      }),
    )
    expect(em.persist).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
  })

  it('rejects services that are not bookable for the organization', async () => {
    mockListBookableServicesForOrganization.mockResolvedValue([])
    const { createAppointmentFromPublicIntake } = await import('../intake')

    await expect(
      createAppointmentFromPublicIntake(em as never, {
        tenantId,
        organizationId,
        requestedStartAt: '2026-09-01T10:00:00.000Z',
        bookingType: 'call_in',
        customer: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          phone: '+15551212',
          source: 'facebook',
          origin: 'tourist',
        },
        lines: [{ productId }],
      }),
    ).rejects.toMatchObject({ status: 400, body: { code: 'SERVICE_NOT_BOOKABLE' } })
  })
})
