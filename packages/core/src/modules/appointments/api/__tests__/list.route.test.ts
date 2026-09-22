/** @jest-environment node */

const mockResolveTranslations = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()

class Appointment {}
class AppointmentLine {}
class AppointmentLineOptionGroup {}
class AppointmentLineOption {}
class Organization {}
class ResourcesAssignment {}
class CatalogProductOption {}

jest.mock('../../data/entities', () => ({
  Appointment,
  AppointmentLine,
  AppointmentLineOptionGroup,
  AppointmentLineOption,
}))
jest.mock('@open-mercato/core/modules/directory/data/entities', () => ({ Organization }))
jest.mock('@open-mercato/core/modules/catalog/data/entities', () => ({ CatalogProductOption }))
jest.mock('@open-mercato/core/modules/resources/data/entities', () => ({ ResourcesAssignment }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => mockResolveTranslations(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) =>
    mockResolveOrganizationScopeForRequest(...args),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const APPOINTMENT_ID = '33333333-3333-4333-8333-333333333333'

describe('appointments list route totals', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockResolveTranslations.mockResolvedValue({
      translate: (_key: string, fallback?: string) => fallback ?? _key,
    })
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: TENANT_ID, orgId: ORGANIZATION_ID })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: ORGANIZATION_ID })
  })

  it('filters appointments by an inclusive requested start date range', async () => {
    const em = {
      find: jest.fn(async () => []),
      findAndCount: jest.fn(async () => [[], 0]),
    }
    mockCreateRequestContainer.mockResolvedValue({
      resolve: () => ({ fork: () => em }),
    })

    const { GET } = await import('../route')
    const response = await GET(new Request(
      'http://localhost/api/appointments?requestedStartAtFrom=2026-09-21&requestedStartAtTo=2026-09-23',
    ))

    expect(response.status).toBe(200)
    expect(em.findAndCount).toHaveBeenCalledWith(Appointment, expect.objectContaining({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      requestedStartAt: {
        $gte: new Date('2026-09-21T00:00:00.000Z'),
        $lte: new Date('2026-09-23T23:59:59.999Z'),
      },
      deletedAt: null,
    }), expect.anything())
  })

  it('rejects invalid requested start date ranges', async () => {
    const { GET } = await import('../route')
    const response = await GET(new Request(
      'http://localhost/api/appointments?requestedStartAtFrom=2026-09-24&requestedStartAtTo=2026-09-23',
    ))

    expect(response.status).toBe(400)
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
  })

  it('returns no total when every appointment line has no stored price', async () => {
    const appointment = {
      id: APPOINTMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      customerEntityId: null,
      customerName: 'Test Customer',
      statusCode: 'new_request',
      requestedStartAt: new Date('2026-09-20T10:00:00.000Z'),
      requestedEndAt: null,
      createdAt: new Date('2026-09-16T10:00:00.000Z'),
      updatedAt: new Date('2026-09-16T10:00:00.000Z'),
    }
    const line = {
      appointment,
      unitPriceGross: null,
      unitPriceNet: null,
      currencyCode: 'VND',
    }
    const find = jest.fn(async (entity: unknown) => {
        if (entity === Appointment) return [appointment]
        if (entity === AppointmentLine) return [line]
        return []
      })
    const em = {
      find,
      findAndCount: jest.fn(async (entity: unknown, where: unknown, options: unknown) => [
        await find(entity, where, options),
        1,
      ]),
    }
    mockCreateRequestContainer.mockResolvedValue({
      resolve: () => ({ fork: () => em }),
    })

    const { GET } = await import('../route')
    const response = await GET(new Request('http://localhost/api/appointments'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items[0]).toMatchObject({ totalAmount: null, currencyCode: null })
  })

  it('uses selected option prices when the service itself has no stored price', async () => {
    const appointment = {
      id: APPOINTMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      customerEntityId: null,
      customerName: 'Test Customer',
      statusCode: 'new_request',
      requestedStartAt: new Date('2026-09-20T10:00:00.000Z'),
      requestedEndAt: null,
      createdAt: new Date('2026-09-16T10:00:00.000Z'),
      updatedAt: new Date('2026-09-16T10:00:00.000Z'),
    }
    const line = {
      id: '44444444-4444-4444-8444-444444444444',
      appointment,
      unitPriceGross: null,
      unitPriceNet: null,
      currencyCode: 'VND',
    }
    const group = { id: '55555555-5555-4555-8555-555555555555', line }
    const option = {
      group,
      priceFlat: '690000.00',
    }
    const find = jest.fn(async (entity: unknown) => {
        if (entity === Appointment) return [appointment]
        if (entity === AppointmentLine) return [line]
        if (entity === AppointmentLineOptionGroup) return [group]
        if (entity === AppointmentLineOption) return [option]
        return []
      })
    const em = {
      find,
      findAndCount: jest.fn(async (entity: unknown, where: unknown, options: unknown) => [
        await find(entity, where, options),
        1,
      ]),
    }
    mockCreateRequestContainer.mockResolvedValue({
      resolve: () => ({ fork: () => em }),
    })

    const { GET } = await import('../route')
    const response = await GET(new Request('http://localhost/api/appointments'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items[0]).toMatchObject({ totalAmount: 690000, currencyCode: 'VND' })
  })

  it('falls back to selected catalog option prices for lines without option snapshots', async () => {
    const appointment = {
      id: APPOINTMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      customerEntityId: null,
      customerName: 'Legacy Booking',
      statusCode: 'new_request',
      requestedStartAt: new Date('2026-09-18T10:00:00.000Z'),
      requestedEndAt: null,
      createdAt: new Date('2026-09-15T10:00:00.000Z'),
      updatedAt: new Date('2026-09-15T10:00:00.000Z'),
    }
    const optionId = '55555555-5555-4555-8555-555555555555'
    const line = {
      id: '44444444-4444-4444-8444-444444444444',
      appointment,
      organizationId: ORGANIZATION_ID,
      unitPriceGross: null,
      unitPriceNet: null,
      currencyCode: 'VND',
      selectedOptions: { '66666666-6666-4666-8666-666666666666': [optionId] },
    }
    const find = jest.fn(async (entity: unknown) => {
        if (entity === Appointment) return [appointment]
        if (entity === AppointmentLine) return [line]
        if (entity === CatalogProductOption) return [{ id: optionId, priceFlat: '675000.00' }]
        return []
      })
    const em = {
      find,
      findAndCount: jest.fn(async (entity: unknown, where: unknown, options: unknown) => [
        await find(entity, where, options),
        1,
      ]),
    }
    mockCreateRequestContainer.mockResolvedValue({
      resolve: () => ({ fork: () => em }),
    })

    const { GET } = await import('../route')
    const response = await GET(new Request('http://localhost/api/appointments'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items[0]).toMatchObject({ totalAmount: 675000, currencyCode: 'VND' })
    expect(em.find).toHaveBeenCalledWith(CatalogProductOption, expect.objectContaining({
      tenantId: TENANT_ID,
      organizationId: { $in: [ORGANIZATION_ID] },
    }))
  })

  it('applies requested pagination and returns totals', async () => {
    const appointment = {
      id: APPOINTMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      customerEntityId: null,
      customerName: 'Paged Customer',
      statusCode: 'new_request',
      requestedStartAt: new Date('2026-09-20T10:00:00.000Z'),
      requestedEndAt: null,
      createdAt: new Date('2026-09-16T10:00:00.000Z'),
      updatedAt: new Date('2026-09-16T10:00:00.000Z'),
    }
    const find = jest.fn(async (entity: unknown) => {
      if (entity === Appointment) return [appointment]
      return []
    })
    const findAndCount = jest.fn(async (entity: unknown, where: unknown, options: unknown) => [
      await find(entity, where, options),
      25,
    ])
    const em = { find, findAndCount }
    mockCreateRequestContainer.mockResolvedValue({
      resolve: () => ({ fork: () => em }),
    })

    const { GET } = await import('../route')
    const response = await GET(new Request('http://localhost/api/appointments?page=2&pageSize=10'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ total: 25, page: 2, pageSize: 10, totalPages: 3 })
    expect(findAndCount).toHaveBeenCalledWith(
      Appointment,
      expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }),
      expect.objectContaining({ limit: 10, offset: 10 }),
    )
  })
})
