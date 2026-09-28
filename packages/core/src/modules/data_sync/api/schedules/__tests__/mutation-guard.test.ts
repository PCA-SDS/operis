/** @jest-environment node */

const SCHEDULE_ID = '123e4567-e89b-12d3-a456-426614174070'
const INTEGRATION_ID = 'demo-provider'

const mockGetAuthFromRequest = jest.fn()

const mockScheduleService = {
  saveSchedule: jest.fn(),
}

const mockGuardValidate = jest.fn()
const mockGuardAfterSuccess = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: jest.fn((req: Request) => req.json()),
}))

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'dataSyncScheduleService') return mockScheduleService
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { POST } from '../route'

beforeAll(() => {
  registerMutationGuards([{
    moduleId: 'data_sync_test',
    guards: [{
      id: 'data_sync_test.schedule-guard',
      targetEntity: 'data_sync.schedule',
      operations: ['create', 'update'],
      validate: (input) => mockGuardValidate(input),
      afterSuccess: (input) => mockGuardAfterSuccess(input),
    }],
  }])
})

afterAll(() => {
  registerMutationGuards([])
})

function request() {
  return new Request('http://localhost/api/data_sync/schedules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      integrationId: INTEGRATION_ID,
      entityType: 'products',
      direction: 'import',
      scheduleType: 'cron',
      scheduleValue: '0 * * * *',
      timezone: 'UTC',
      fullSync: false,
      isEnabled: true,
    }),
  })
}

describe('data_sync schedule create mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    mockScheduleService.saveSchedule.mockResolvedValue({
      id: SCHEDULE_ID,
      integrationId: INTEGRATION_ID,
      entityType: 'products',
      direction: 'import',
      scheduleType: 'cron',
      scheduleValue: '0 * * * *',
      timezone: 'UTC',
      fullSync: false,
      isEnabled: true,
      scheduledJobId: SCHEDULE_ID,
      lastRunAt: null,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      createdAt: new Date('2026-05-01T10:00:00.000Z'),
      updatedAt: new Date('2026-06-01T10:00:00.000Z'),
      deletedAt: null,
    })
    mockGuardValidate.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true })
    mockGuardAfterSuccess.mockResolvedValue(undefined)
  })

  it('runs the guard before the write and the after-success hook after it', async () => {
    const res = await POST(request())
    expect(res.status).toBe(201)
    expect(mockGuardValidate).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: 'data_sync.schedule',
      operation: 'create',
    }))
    expect(mockScheduleService.saveSchedule).toHaveBeenCalled()
    expect(mockGuardAfterSuccess).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: 'data_sync.schedule',
      resourceId: SCHEDULE_ID,
    }))
  })

  it('short-circuits the write when the guard blocks the mutation', async () => {
    mockGuardValidate.mockResolvedValueOnce({
      ok: false,
      status: 403,
      body: { error: 'Blocked by guard' },
    })

    const res = await POST(request())
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Blocked by guard' })
    expect(mockScheduleService.saveSchedule).not.toHaveBeenCalled()
    expect(mockGuardAfterSuccess).not.toHaveBeenCalled()
  })
})
