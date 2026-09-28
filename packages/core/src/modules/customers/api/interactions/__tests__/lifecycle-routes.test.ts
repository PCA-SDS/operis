/** @jest-environment node */
import { deserializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const interactionId = '44444444-4444-4444-8444-444444444444'

const commandBusExecuteMock = jest.fn()
const runRouteMutationGuardsMock = jest.fn()
const runAfterSuccessMock = jest.fn()
const getAuthFromRequestMock = jest.fn()

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
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedId: organizationId, filterIds: [organizationId] })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key })),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

import { POST as cancelInteraction } from '../cancel/route'
import { POST as completeInteraction } from '../complete/route'

function request(path: string, body: unknown) {
  return new Request(`http://localhost/api/customers/interactions/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const logEntry = {
  id: 'log-1',
  undoToken: 'undo-1',
  commandId: 'customers.interactions.cancel',
  actionLabel: null,
  resourceKind: null,
  resourceId: null,
  createdAt: new Date('2026-09-28T10:00:00.000Z'),
}

describe.each([
  ['cancel', cancelInteraction, 'customers.interactions.cancel', { id: interactionId }],
  ['complete', completeInteraction, 'customers.interactions.complete', { id: interactionId }],
] as const)('customers interaction %s route', (path, handler, commandId, body) => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
    runRouteMutationGuardsMock.mockResolvedValue({ ok: true, runAfterSuccess: runAfterSuccessMock })
    runAfterSuccessMock.mockResolvedValue(undefined)
    commandBusExecuteMock.mockResolvedValue({ result: { interactionId }, logEntry: { ...logEntry, commandId } })
  })

  it('guards the write, runs the command and returns the undo header', async () => {
    const response = await handler(request(path, body))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        container,
        auth: expect.objectContaining({ userId, tenantId, organizationId }),
        input: expect.objectContaining({
          resourceKind: 'customers.interaction',
          resourceId: interactionId,
          operation: 'custom',
        }),
      }),
    )
    expect(commandBusExecuteMock).toHaveBeenCalledWith(
      commandId,
      expect.objectContaining({ input: expect.objectContaining({ id: interactionId }) }),
    )
    expect(runAfterSuccessMock).toHaveBeenCalledTimes(1)
    expect(deserializeOperationMetadata(response.headers.get('x-om-operation'))).toMatchObject({
      commandId,
      resourceKind: 'customers.interaction',
      resourceId: interactionId,
    })
  })

  it('returns the guard rejection without running the command', async () => {
    runRouteMutationGuardsMock.mockResolvedValueOnce({ ok: false, errorStatus: 423, errorBody: { error: 'locked' } })

    const response = await handler(request(path, body))

    expect(response.status).toBe(423)
    await expect(response.json()).resolves.toEqual({ error: 'locked' })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('answers 400 with validation details for an invalid payload', async () => {
    const response = await handler(request(path, { id: 'not-a-uuid' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Validation failed' })
    expect(runRouteMutationGuardsMock).not.toHaveBeenCalled()
  })

  it('answers 401 when the caller has no tenant', async () => {
    getAuthFromRequestMock.mockResolvedValueOnce(null)

    const response = await handler(request(path, body))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('answers 500 when the command fails unexpectedly', async () => {
    commandBusExecuteMock.mockRejectedValueOnce(new Error('boom'))

    const response = await handler(request(path, body))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
    expect(runAfterSuccessMock).not.toHaveBeenCalled()
  })
})
