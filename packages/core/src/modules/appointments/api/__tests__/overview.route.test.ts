/** @jest-environment node */

const mockResolveTranslations = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockLoadResourceAvailabilityWindows = jest.fn()
const mockResolveResourceOrganizationIds = jest.fn()

class Appointment {}
class AppointmentLine {}
class AppointmentLineOptionGroup {}
class CatalogProductOptionGroup {}
class CatalogProductOption {}
class Organization {}
class ResourcesAssignment {}
class StaffTeamMember {}

jest.mock('../../data/entities', () => ({
  Appointment,
  AppointmentLine,
  AppointmentLineOptionGroup,
}))
jest.mock('@open-mercato/core/modules/catalog/data/entities', () => ({
  CatalogProductOptionGroup,
  CatalogProductOption,
}))
jest.mock('@open-mercato/core/modules/directory/data/entities', () => ({ Organization }))
jest.mock('@open-mercato/core/modules/resources/data/entities', () => ({ ResourcesAssignment }))
jest.mock('@open-mercato/core/modules/staff/data/entities', () => ({ StaffTeamMember }))
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
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))
jest.mock('@open-mercato/core/modules/resources/lib/resourceAssignmentService', () => ({
  ResourceAssignmentService: class {
    async getWorkspace() {
      return { resources: [] }
    }
  },
}))
jest.mock('../../lib/resourceAvailability', () => ({
  loadResourceAvailabilityWindows: (...args: unknown[]) => mockLoadResourceAvailabilityWindows(...args),
  resolveResourceOrganizationIds: (...args: unknown[]) => mockResolveResourceOrganizationIds(...args),
}))
jest.mock('../../lib/scheduleTracking', () => ({
  deriveScheduleConfirmationStatus: () => 'confirmed',
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const APPOINTMENT_ID = '33333333-3333-4333-8333-333333333333'
const LINE_ID = '44444444-4444-4444-8444-444444444444'
const RESOURCE_ID = '55555555-5555-4555-8555-555555555555'

describe('appointments overview route', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockResolveTranslations.mockResolvedValue({
      translate: (_key: string, fallback?: string) => fallback ?? _key,
    })
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: TENANT_ID, orgId: ORGANIZATION_ID })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: ORGANIZATION_ID })
    mockFindWithDecryption.mockResolvedValue([])
    mockLoadResourceAvailabilityWindows.mockResolvedValue(new Map())
    mockResolveResourceOrganizationIds.mockResolvedValue([ORGANIZATION_ID])
  })

  it('returns confirmed assignments only, leaving seat planner drafts out of the overview', async () => {
    const appointment = {
      id: APPOINTMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      customerName: 'Test Customer',
      customerSalutation: null,
      customerPhone: null,
      customerPhoneCountryCode: null,
      bookingType: null,
      statusCode: 'deposit_received_booked',
      requestedStartAt: new Date('2026-09-24T07:00:00.000Z'),
      requestedEndAt: new Date('2026-09-24T08:00:00.000Z'),
      createdAt: new Date('2026-09-20T07:00:00.000Z'),
    }
    const line = {
      id: LINE_ID,
      appointment,
      productId: 'product-1',
      productTitle: 'Service',
      productCategory: null,
      durationMinutes: 60,
      selectedOptions: { 'legacy-group': ['legacy-option'] },
      sortOrder: 0,
    }
    const resource = { id: RESOURCE_ID, name: 'Resource 1' }
    const buildAssignment = (state: 'draft' | 'confirmed') => ({
      id: `${state}-assignment`,
      sourceEntityId: LINE_ID,
      state,
      resource,
      startsAt: new Date('2026-09-24T07:00:00.000Z'),
      endsAt: new Date('2026-09-24T08:00:00.000Z'),
      assignedMemberId: null,
      assignedMemberIds: [],
      cancelledAt: null,
    })
    const draft = buildAssignment('draft')
    const confirmed = buildAssignment('confirmed')
    const em = {
      findOne: jest.fn(async (entity: unknown) => entity === Organization
        ? { id: ORGANIZATION_ID, name: 'Organization 1' }
        : null),
      find: jest.fn(async (entity: unknown, where?: { state?: string }) => {
        if (entity === Appointment) return [appointment]
        if (entity === AppointmentLine) return [line]
        if (entity === ResourcesAssignment) return where?.state === 'confirmed' ? [confirmed] : [draft, confirmed]
        if (entity === AppointmentLineOptionGroup) return []
        if (entity === CatalogProductOptionGroup) return [{ id: 'legacy-group', name: 'Area' }]
        if (entity === CatalogProductOption) return [{ id: 'legacy-option', group: 'legacy-group', name: 'Underarms' }]
        return []
      }),
    }
    mockCreateRequestContainer.mockResolvedValue({
      resolve: () => ({ fork: () => em }),
    })

    const { GET } = await import('../overview/route')
    const response = await GET(new Request(
      `http://localhost/api/appointments/overview?date=2026-09-24&organizationId=${ORGANIZATION_ID}`,
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.blocks).toHaveLength(1)
    expect(body.blocks[0]).toMatchObject({ id: 'confirmed-assignment', state: 'confirmed' })
    expect(body.appointments[0].lines[0].options).toEqual([{ groupName: 'Area', name: 'Underarms' }])
    const assignmentQueries = em.find.mock.calls.filter((call) => call[0] === ResourcesAssignment)
    expect(assignmentQueries).toHaveLength(2)
    expect(assignmentQueries.every((call) => call[1].state === 'confirmed')).toBe(true)
  })
})
