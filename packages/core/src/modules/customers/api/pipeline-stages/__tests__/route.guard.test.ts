/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const stageId = '55555555-5555-4555-8555-555555555555'
const pipelineId = '44444444-4444-4444-8444-444444444444'

const runRouteMutationGuardsMock = jest.fn()
const runAfterSuccessMock = jest.fn()
const commandBusExecuteMock = jest.fn()

const commandBus = { execute: commandBusExecuteMock }
const container = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return commandBus
    if (token === 'em') return {}
    return {}
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: userId, tenantId, orgId: organizationId })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: organizationId,
    filterIds: [organizationId],
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

import { POST, PUT, DELETE } from '../route'

const jsonRequest = (method: string, body: unknown) =>
  new Request('http://localhost/api/customers/pipeline-stages', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('customers pipeline-stages route mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    runRouteMutationGuardsMock.mockResolvedValue({ ok: true, runAfterSuccess: runAfterSuccessMock })
    runAfterSuccessMock.mockResolvedValue(undefined)
    commandBusExecuteMock.mockResolvedValue({ result: { stageId }, logEntry: null })
  })

  it('runs the guard before create and the after-success hook on success', async () => {
    const response = await POST(jsonRequest('POST', { pipelineId, label: 'Lead' }))

    expect(response.status).toBe(201)
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        container,
        auth: expect.objectContaining({ tenantId, organizationId, userId }),
        input: expect.objectContaining({ resourceKind: 'customers.pipelineStage', operation: 'create' }),
      }),
    )
    expect(commandBusExecuteMock).toHaveBeenCalledWith('customers.pipeline-stages.create', expect.anything())
    expect(runAfterSuccessMock).toHaveBeenCalledWith({ resourceId: stageId })
  })

  it('short-circuits create when the guard blocks the mutation', async () => {
    runRouteMutationGuardsMock.mockResolvedValueOnce({ ok: false, errorStatus: 423, errorBody: { error: 'locked' } })

    const response = await POST(jsonRequest('POST', { pipelineId, label: 'Lead' }))

    expect(response.status).toBe(423)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(runAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('guards update with the stage id as the resource', async () => {
    commandBusExecuteMock.mockResolvedValueOnce({ logEntry: null })

    const response = await PUT(jsonRequest('PUT', { id: stageId, label: 'Renamed' }))

    expect(response.status).toBe(200)
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        container,
        input: expect.objectContaining({
          resourceKind: 'customers.pipelineStage',
          resourceId: stageId,
          operation: 'update',
        }),
      }),
    )
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it('short-circuits delete when the guard blocks the mutation', async () => {
    runRouteMutationGuardsMock.mockResolvedValueOnce({ ok: false, errorStatus: 423, errorBody: { error: 'locked' } })

    const response = await DELETE(jsonRequest('DELETE', { id: stageId }))

    expect(response.status).toBe(423)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })
})
