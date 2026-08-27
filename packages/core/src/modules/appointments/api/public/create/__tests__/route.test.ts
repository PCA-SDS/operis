/** @jest-environment node */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockCreateAppointmentFromPublicIntake = jest.fn()
const mockResolveTranslations = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockEmitAppointmentEvent = jest.fn()

jest.mock('../../../../lib/intake', () => ({
  createAppointmentFromPublicIntake: (...args: unknown[]) =>
    mockCreateAppointmentFromPublicIntake(...args),
}))

jest.mock('../../../../events', () => ({
  emitAppointmentEvent: (...args: unknown[]) => mockEmitAppointmentEvent(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => mockResolveTranslations(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

const validPublicBody = {
  tenantId: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
  requestedStartAt: '2026-09-01T10:00:00.000Z',
  bookingType: 'booking_form',
  customer: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '+15551212',
    source: 'typeform',
    origin: 'local' as const,
  },
  lines: [{ productId: '11111111-1111-4111-8111-111111111111' }],
}

describe('appointments public create route', () => {
  beforeEach(() => {
    jest.resetModules()
    mockResolveTranslations.mockResolvedValue({
      translate: (_key: string, fallback?: string) => fallback ?? _key,
    })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: () => ({ fork: () => ({}) }),
    })
    mockCreateAppointmentFromPublicIntake.mockReset()
    mockEmitAppointmentEvent.mockReset()
  })

  it('returns 201 for a valid intake payload', async () => {
    mockCreateAppointmentFromPublicIntake.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      statusCode: 'new_request',
      customerEntityId: '44444444-4444-4444-8444-444444444444',
      customerCreated: true,
      requestedStartAt: '2026-09-01T10:00:00.000Z',
      requestedEndAt: '2026-09-01T11:00:00.000Z',
      lineCount: 1,
    })

    const { POST } = await import('../route')
    const response = await POST(
      new Request('http://localhost/api/appointments/public/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validPublicBody),
      }),
    )

    expect(response.status).toBe(201)
    const payload = await response.json()
    expect(payload.statusCode).toBe('new_request')
    expect(mockEmitAppointmentEvent).toHaveBeenCalled()
  })

  it('maps intake CrudHttpError to HTTP status', async () => {
    mockCreateAppointmentFromPublicIntake.mockRejectedValue(
      new CrudHttpError(400, { error: 'Service not bookable.', code: 'SERVICE_NOT_BOOKABLE' }),
    )

    const { POST } = await import('../route')
    const response = await POST(
      new Request('http://localhost/api/appointments/public/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validPublicBody),
      }),
    )

    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.code).toBe('SERVICE_NOT_BOOKABLE')
  })
})
