/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
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
  new Request('http://localhost/api/customers/pipelines', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('customers pipelines route mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    runRouteMutationGuardsMock.mockResolvedValue({ ok: true, runAfterSuccess: runAfterSuccessMock })
    runAfterSuccessMock.mockResolvedValue(undefined)
    commandBusExecuteMock.mockResolvedValue({ result: { pipelineId }, logEntry: null })
  })

  it('runs the guard before create and the after-success hook on success', async () => {
    const response = await POST(jsonRequest('POST', { name: 'Sales' }))

    expect(response.status).toBe(201)
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        container,
        auth: expect.objectContaining({ tenantId, organizationId, userId }),
        input: expect.objectContaining({
          resourceKind: 'customers.pipeline',
          operation: 'create',
          mutationPayload: expect.objectContaining({ name: 'Sales' }),
        }),
      }),
    )
    expect(commandBusExecuteMock).toHaveBeenCalledWith('customers.pipelines.create', expect.anything())
    expect(runAfterSuccessMock).toHaveBeenCalledWith({ resourceId: pipelineId })
  })

  it('short-circuits create when the guard blocks the mutation', async () => {
    runRouteMutationGuardsMock.mockResolvedValueOnce({ ok: false, errorStatus: 423, errorBody: { error: 'locked' } })

    const response = await POST(jsonRequest('POST', { name: 'Sales' }))

    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({ error: 'locked' })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(runAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('guards update with the pipeline id as the resource', async () => {
    commandBusExecuteMock.mockResolvedValueOnce({ logEntry: null })

    const response = await PUT(jsonRequest('PUT', { id: pipelineId, name: 'Renamed' }))

    expect(response.status).toBe(200)
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        container,
        input: expect.objectContaining({
          resourceKind: 'customers.pipeline',
          resourceId: pipelineId,
          operation: 'update',
        }),
      }),
    )
    expect(commandBusExecuteMock).toHaveBeenCalledWith('customers.pipelines.update', expect.anything())
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it('short-circuits delete when the guard blocks the mutation', async () => {
    runRouteMutationGuardsMock.mockResolvedValueOnce({ ok: false, errorStatus: 423, errorBody: { error: 'locked' } })

    const response = await DELETE(jsonRequest('DELETE', { id: pipelineId }))

    expect(response.status).toBe(423)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })
})
