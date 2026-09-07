/** @jest-environment node */

/**
 * Optimistic locking on the staff status change.
 *
 * The detail page already wrapped its PATCH in
 * `withScopedApiRequestHeaders(buildOptimisticLockHeader(detail.updatedAt))`
 * and already handled a 409 through `surfaceRecordConflict` — but the route
 * never read the header back, so two staff members moving the same appointment
 * silently overwrote each other. These pin the server half.
 */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const mockResolveTranslations = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockEmitAppointmentEvent = jest.fn()

class Appointment {}
class AppointmentStatus {}
class AppointmentLine {}

jest.mock('../../data/entities', () => ({
  Appointment,
  AppointmentStatus,
  AppointmentLine,
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

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const APPOINTMENT_ID = '22222222-2222-4222-8222-222222222222'
const STORED_UPDATED_AT = '2026-09-07T10:00:00.000Z'
const STALE_UPDATED_AT = '2026-09-07T09:00:00.000Z'

function buildAppointment() {
  return Object.assign(new Appointment(), {
    id: APPOINTMENT_ID,
    tenantId: TENANT_ID,
    organizationId: '33333333-3333-4333-8333-333333333333',
    customerEntityId: '44444444-4444-4444-8444-444444444444',
    customerName: 'Ada Lovelace',
    customerSalutation: null,
    customerPhone: '+84900000000',
    customerEmail: null,
    statusCode: 'new_request',
    requestedStartAt: new Date('2026-09-20T02:00:00.000Z'),
    requestedEndAt: null,
    notes: null,
    updatedAt: new Date(STORED_UPDATED_AT),
    status: null as unknown,
  })
}

function buildEm(appointment: ReturnType<typeof buildAppointment>) {
  return {
    flush: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === AppointmentStatus) {
        return Object.assign(new AppointmentStatus(), { id: 'status-1', code: 'confirmed' })
      }
      return appointment
    }),
  }
}

function patchRequest(headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/appointments/${APPOINTMENT_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ statusCode: 'confirmed' }),
  })
}

describe('appointments detail route — optimistic locking', () => {
  let appointment: ReturnType<typeof buildAppointment>
  let em: ReturnType<typeof buildEm>

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    appointment = buildAppointment()
    em = buildEm(appointment)
    mockResolveTranslations.mockResolvedValue({
      translate: (_key: string, fallback?: string) => fallback ?? _key,
    })
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: TENANT_ID, sub: 'user-1' })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: () => ({ fork: () => em }),
    })
    mockEmitAppointmentEvent.mockResolvedValue(undefined)
  })

  async function patch(headers?: Record<string, string>) {
    const { PATCH } = await import('../[id]/route')
    return PATCH(patchRequest(headers), { params: Promise.resolve({ id: APPOINTMENT_ID }) })
  }

  it('rejects a status change carrying a stale version', async () => {
    const response = await patch({ [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT })

    expect(response.status).toBe(409)
    expect(em.flush).not.toHaveBeenCalled()
    expect(appointment.statusCode).toBe('new_request')
    expect(mockEmitAppointmentEvent).not.toHaveBeenCalled()
  })

  it('applies the status change when the version matches', async () => {
    const response = await patch({ [OPTIMISTIC_LOCK_HEADER_NAME]: STORED_UPDATED_AT })

    expect(response.status).toBe(200)
    expect(appointment.statusCode).toBe('confirmed')
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('still applies the change when no version header is sent', async () => {
    // `assertOptimisticLock` treats a missing expectation as "no opinion", so
    // API clients that predate the header keep working.
    const response = await patch()

    expect(response.status).toBe(200)
    expect(appointment.statusCode).toBe('confirmed')
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})
