/** @jest-environment node */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockCreateAppointmentFromPublicIntake = jest.fn()
const mockResolveTranslations = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockEmitAppointmentEvent = jest.fn()
const mockGetAuthFromRequest = jest.fn()

jest.mock('../../lib/intake', () => ({
  createAppointmentFromPublicIntake: (...args: unknown[]) =>
    mockCreateAppointmentFromPublicIntake(...args),
}))

jest.mock('../../data/entities', () => ({
  Appointment: class Appointment {},
}))

jest.mock('../../events', () => ({
  emitAppointmentEvent: (...args: unknown[]) => mockEmitAppointmentEvent(...args),
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

describe('appointments staff create route', () => {
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
    mockGetAuthFromRequest.mockReset()
  })

  it('creates via auth tenant/org and returns 201', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      tenantId: '22222222-2222-4222-8222-222222222222',
      orgId: '33333333-3333-4333-8333-333333333333',
    })
    mockCreateAppointmentFromPublicIntake.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      statusCode: 'new_request',
      customerEntityId: '44444444-4444-4444-8444-444444444444',
      customerCreated: true,
      requestedStartAt: '2026-09-01T10:00:00.000Z',
      requestedEndAt: null,
      lineCount: 1,
    })

    const { POST } = await import('../route')
    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestedStartAt: '2026-09-01T10:00:00.000Z',
          customer: {
            firstName: 'Ada',
            lastName: 'Lovelace',
            phone: '+15551212',
          },
          lines: [{ productId: '11111111-1111-4111-8111-111111111111' }],
        }),
      }),
    )

    expect(response.status).toBe(201)
    expect(mockCreateAppointmentFromPublicIntake).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: '22222222-2222-4222-8222-222222222222',
        organizationId: '33333333-3333-4333-8333-333333333333',
      }),
    )
  })

  it('rejects when org scope is missing', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      tenantId: '22222222-2222-4222-8222-222222222222',
      orgId: null,
    })

    const { POST } = await import('../route')
    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestedStartAt: '2026-09-01T10:00:00.000Z',
          customer: {
            firstName: 'Ada',
            lastName: 'Lovelace',
            phone: '+15551212',
          },
          lines: [{ productId: '11111111-1111-4111-8111-111111111111' }],
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mockCreateAppointmentFromPublicIntake).not.toHaveBeenCalled()
  })

  it('maps intake errors', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      tenantId: '22222222-2222-4222-8222-222222222222',
      orgId: '33333333-3333-4333-8333-333333333333',
    })
    mockCreateAppointmentFromPublicIntake.mockRejectedValue(
      new CrudHttpError(400, { error: 'Service not bookable.', code: 'SERVICE_NOT_BOOKABLE' }),
    )

    const { POST } = await import('../route')
    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestedStartAt: '2026-09-01T10:00:00.000Z',
          customer: {
            firstName: 'Ada',
            lastName: 'Lovelace',
            phone: '+15551212',
          },
          lines: [{ productId: '11111111-1111-4111-8111-111111111111' }],
        }),
      }),
    )

    expect(response.status).toBe(400)
  })
})
