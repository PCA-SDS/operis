/** @jest-environment node */

const mockResolveTranslations = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockEnsureSystemAppointmentStatuses = jest.fn()

class AppointmentStatus {}

jest.mock('../../../data/entities', () => ({ AppointmentStatus }))
jest.mock('../../../data/validators', () => ({
  appointmentStatusCatalogCreateSchema: {
    parse: (value: unknown) => value,
  },
}))
jest.mock('../../../setup', () => ({
  ensureSystemAppointmentStatuses: (...args: unknown[]) => mockEnsureSystemAppointmentStatuses(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => mockResolveTranslations(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'

describe('appointment status catalog create route', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockResolveTranslations.mockResolvedValue({
      translate: (_key: string, fallback?: string) => fallback ?? _key,
    })
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: TENANT_ID })
  })

  it('returns a validation conflict instead of 500 for a unique constraint race', async () => {
    const em = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockReturnValue({}),
      persist: jest.fn(),
      flush: jest.fn().mockRejectedValue({
        code: '23505',
        constraint: 'appointment_statuses_tenant_code_unique',
      }),
    }
    mockCreateRequestContainer.mockResolvedValue({
      resolve: () => ({ fork: () => em }),
    })

    const { POST } = await import('../route')
    const response = await POST(
      new Request('http://localhost/api/appointments/statuses', {
        method: 'POST',
        body: JSON.stringify({ code: 'custom_status', label: 'Custom status' }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({
      error: 'A status with that code already exists.',
      code: 'STATUS_CODE_EXISTS',
    })
  })
})
