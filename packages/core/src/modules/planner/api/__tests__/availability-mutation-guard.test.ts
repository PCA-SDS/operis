const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const subjectId = '33333333-3333-4333-8333-333333333333'
const actorId = '44444444-4444-4444-8444-444444444444'

const runRouteMutationGuardsMock = jest.fn()
const runAfterSuccessMock = jest.fn()
const commandBusExecuteMock = jest.fn()
const assertAvailabilityWriteAccessMock = jest.fn()
const parseScopedCommandInputMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'commandBus') return { execute: (...args: unknown[]) => commandBusExecuteMock(...args) }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: actorId, tenantId, orgId: organizationId })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedId: organizationId, filterIds: [organizationId] })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback?: string) => fallback ?? 'error' })),
}))

jest.mock('@open-mercato/shared/lib/api/scoped', () => ({
  parseScopedCommandInput: (...args: unknown[]) => parseScopedCommandInputMock(...args),
}))

jest.mock('../access', () => {
  const actual = jest.requireActual('../access')
  return {
    ...actual,
    assertAvailabilityWriteAccess: (...args: unknown[]) => assertAvailabilityWriteAccessMock(...args),
  }
})

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

import { POST as replaceWeekly } from '../availability-weekly'
import { POST as replaceDateSpecific } from '../availability-date-specific'

const weeklyInput = {
  tenantId,
  organizationId,
  subjectType: 'member' as const,
  subjectId,
  timezone: 'UTC',
  windows: [],
}

const dateSpecificInput = {
  tenantId,
  organizationId,
  subjectType: 'member' as const,
  subjectId,
  timezone: 'UTC',
  date: '2026-04-11',
  dates: ['2026-04-11'],
  windows: [],
  isAvailable: true,
}

const expectedGuardCall = {
  container,
  auth: expect.objectContaining({ tenantId, organizationId, userId: actorId }),
  input: expect.objectContaining({
    resourceKind: 'planner.availability',
    resourceId: subjectId,
    operation: 'custom',
  }),
}

function makeRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost/api/planner/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('planner availability bulk replace routes — mutation guard lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    assertAvailabilityWriteAccessMock.mockResolvedValue({
      canManageAll: true,
      canManageSelf: true,
      canManageUnavailability: true,
      memberId: subjectId,
      tenantId,
      organizationId,
    })
    commandBusExecuteMock.mockResolvedValue({ logEntry: null })
    runRouteMutationGuardsMock.mockResolvedValue({ ok: true, runAfterSuccess: runAfterSuccessMock })
    runAfterSuccessMock.mockResolvedValue(undefined)
  })

  describe('weekly availability replace', () => {
    beforeEach(() => {
      parseScopedCommandInputMock.mockReturnValue(weeklyInput)
    })

    it('runs the mutation guard before and after a successful replace', async () => {
      const response = await replaceWeekly(makeRequest('availability-weekly', { subjectType: 'member', subjectId, windows: [] }))

      expect(response.status).toBe(200)
      expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(expect.objectContaining(expectedGuardCall))
      expect(commandBusExecuteMock).toHaveBeenCalledWith('planner.availability.weekly.replace', expect.anything())
      expect(runAfterSuccessMock).toHaveBeenCalledTimes(1)
      expect(commandBusExecuteMock.mock.invocationCallOrder[0]).toBeLessThan(runAfterSuccessMock.mock.invocationCallOrder[0])
    })

    it('blocks the replace when a registered guard rejects it', async () => {
      runRouteMutationGuardsMock.mockResolvedValueOnce({
        ok: false,
        errorStatus: 409,
        errorBody: { error: { code: 'RECORD_LOCKED' } },
      })

      const response = await replaceWeekly(makeRequest('availability-weekly', { subjectType: 'member', subjectId, windows: [] }))

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({ error: { code: 'RECORD_LOCKED' } })
      expect(commandBusExecuteMock).not.toHaveBeenCalled()
      expect(runAfterSuccessMock).not.toHaveBeenCalled()
    })
  })

  describe('date-specific availability replace', () => {
    beforeEach(() => {
      parseScopedCommandInputMock.mockReturnValue(dateSpecificInput)
    })

    it('runs the mutation guard before and after a successful replace', async () => {
      const response = await replaceDateSpecific(makeRequest('availability-date-specific', { subjectType: 'member', subjectId, date: '2026-04-11', windows: [] }))

      expect(response.status).toBe(200)
      expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(expect.objectContaining(expectedGuardCall))
      expect(commandBusExecuteMock).toHaveBeenCalledWith('planner.availability.date-specific.replace', expect.anything())
      expect(runAfterSuccessMock).toHaveBeenCalledTimes(1)
      expect(commandBusExecuteMock.mock.invocationCallOrder[0]).toBeLessThan(runAfterSuccessMock.mock.invocationCallOrder[0])
    })

    it('blocks the replace when a registered guard rejects it', async () => {
      runRouteMutationGuardsMock.mockResolvedValueOnce({
        ok: false,
        errorStatus: 409,
        errorBody: { error: { code: 'RECORD_LOCKED' } },
      })

      const response = await replaceDateSpecific(makeRequest('availability-date-specific', { subjectType: 'member', subjectId, date: '2026-04-11', windows: [] }))

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({ error: { code: 'RECORD_LOCKED' } })
      expect(commandBusExecuteMock).not.toHaveBeenCalled()
      expect(runAfterSuccessMock).not.toHaveBeenCalled()
    })
  })
})
