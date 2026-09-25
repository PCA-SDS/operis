const tenantId = '11111111-1111-4111-8111-111111111111'
const userId = '33333333-3333-4333-8333-333333333333'
const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const getRecordMock = jest.fn()
const setValueMock = jest.fn()
const container = {
  resolve: jest.fn(() => ({
    getRecord: (...args: unknown[]) => getRecordMock(...args),
    setValue: (...args: unknown[]) => setValueMock(...args),
  })),
}
let authValue: Record<string, unknown> | null = { tenantId, sub: userId }

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn(async () => container) }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn(async () => authValue) }))
jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

import { GET, PUT } from '../route'

const makePutRequest = (body: unknown) => new Request('http://localhost/api/appointments/email-settings', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('appointment email settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authValue = { tenantId, sub: userId }
    getRecordMock.mockResolvedValue(null)
    setValueMock.mockResolvedValue(undefined)
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
  })

  it('reads settings in the authenticated tenant scope', async () => {
    getRecordMock.mockResolvedValue({ source: 'tenant', value: { from: 'from@example.com', to: 'spa@example.com', cc: '', bcc: '', replyTo: '' } })
    const response = await GET(new Request('http://localhost/api/appointments/email-settings'))
    expect(response.status).toBe(200)
    expect(getRecordMock).toHaveBeenCalledWith('appointments', 'public_booking_email', { tenantId })
    await expect(response.json()).resolves.toMatchObject({ to: 'spa@example.com' })
  })

  it('ignores instance-level email settings for a tenant', async () => {
    getRecordMock.mockResolvedValue({ source: 'instance', value: { from: '', to: 'other-tenant@example.com', cc: '', bcc: '', replyTo: '' } })
    const response = await GET(new Request('http://localhost/api/appointments/email-settings'))
    await expect(response.json()).resolves.toEqual({ from: '', to: '', cc: '', bcc: '', replyTo: '' })
  })

  it('rejects unauthenticated requests', async () => {
    authValue = null
    const response = await GET(new Request('http://localhost/api/appointments/email-settings'))
    expect(response.status).toBe(401)
  })

  it('validates and persists addresses to the authenticated tenant', async () => {
    const settings = { from: 'NAM <from@example.com>', to: 'spa@example.com,manager@example.com', cc: '', bcc: '', replyTo: 'reply@example.com' }
    const response = await PUT(makePutRequest(settings))
    expect(response.status).toBe(200)
    expect(setValueMock).toHaveBeenCalledWith('appointments', 'public_booking_email', settings, { tenantId })
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(container, expect.objectContaining({ tenantId, userId, resourceKind: 'appointments.email-settings' }))
    await expect(response.json()).resolves.toEqual(settings)
  })

  it('rejects invalid addresses without saving', async () => {
    const response = await PUT(makePutRequest({ from: '', to: 'not-an-email', cc: '', bcc: '', replyTo: '' }))
    expect(response.status).toBe(400)
    expect(setValueMock).not.toHaveBeenCalled()
  })
})
