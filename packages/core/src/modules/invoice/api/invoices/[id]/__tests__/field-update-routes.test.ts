import type { AwilixContainer } from 'awilix'

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockResolveTranslations = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockRunRouteMutationGuards = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => mockResolveTranslations(...args),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
}))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => mockRunRouteMutationGuards(...args),
}))

import * as dueDateRoute from '../due-date/route'
import * as settlementRoute from '../settlement/route'
import * as nonRecoverableRoute from '../non-recoverable/route'

const invoiceId = '11111111-1111-4111-8111-111111111111'
const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const invoice = { id: invoiceId, settled: true }

function createHarness(commandExecute = jest.fn()) {
  const commandBus = { execute: commandExecute }
  const container = {
    resolve: jest.fn((token: string) => token === 'commandBus' ? commandBus : undefined),
  } as unknown as AwilixContainer
  const runAfterSuccess = jest.fn()
  mockCreateRequestContainer.mockResolvedValue(container)
  mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: scope.tenantId, orgId: scope.organizationId })
  mockResolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: scope.organizationId })
  mockResolveTranslations.mockResolvedValue({ translate: (_key: string, fallback?: string) => fallback ?? 'error' })
  mockRunRouteMutationGuards.mockResolvedValue({ ok: true, modifiedPayload: undefined, runAfterSuccess })
  return { commandBus, runAfterSuccess }
}

function patch(path: string, body: unknown) {
  return new Request(`https://example.test/api/invoice/invoices/${invoiceId}/${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe.each([
  ['due-date', dueDateRoute, 'invoice.invoices.update-due-date', { dueDate: null }, { dueDate: 'not-a-date' }],
  ['settlement', settlementRoute, 'invoice.invoices.update-settlement', { settled: true }, { settled: 'yes' }],
  ['non-recoverable', nonRecoverableRoute, 'invoice.invoices.update-non-recoverable', { nonRecoverable: false }, { nonRecoverable: true }],
] as const)('invoice %s route', (path, route, commandId, validBody, invalidBody) => {
  beforeEach(() => jest.clearAllMocks())

  it('runs the guarded command and returns the updated invoice', async () => {
    const commandExecute = jest.fn().mockResolvedValue({ result: { invoice } })
    const { commandBus, runAfterSuccess } = createHarness(commandExecute)

    const response = await route.PATCH(patch(path, validBody), { params: { id: invoiceId } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, invoice })
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        resourceKind: 'invoice.invoice',
        resourceId: invoiceId,
        operation: 'update',
        mutationPayload: validBody,
      }),
    }))
    expect(commandBus.execute).toHaveBeenCalledWith(commandId, expect.objectContaining({
      input: { id: invoiceId, input: validBody },
    }))
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('re-validates a guard-modified payload before running the command', async () => {
    const commandExecute = jest.fn().mockResolvedValue({ result: { invoice } })
    const { commandBus } = createHarness(commandExecute)
    mockRunRouteMutationGuards.mockResolvedValueOnce({ ok: true, modifiedPayload: { unexpected: true }, runAfterSuccess: jest.fn() })

    const response = await route.PATCH(patch(path, validBody), { params: { id: invoiceId } })

    expect(response.status).toBe(400)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('answers 400 for an invalid payload without guarding or running the command', async () => {
    const commandExecute = jest.fn()
    createHarness(commandExecute)

    const response = await route.PATCH(patch(path, invalidBody), { params: { id: invoiceId } })

    expect(response.status).toBe(400)
    expect(mockRunRouteMutationGuards).not.toHaveBeenCalled()
    expect(commandExecute).not.toHaveBeenCalled()
  })

  it('returns the guard rejection', async () => {
    const commandExecute = jest.fn()
    createHarness(commandExecute)
    mockRunRouteMutationGuards.mockResolvedValueOnce({
      ok: false,
      errorStatus: 409,
      errorBody: { error: 'locked' },
      response: Response.json({ error: 'locked' }, { status: 409 }),
    })

    const response = await route.PATCH(patch(path, validBody), { params: { id: invoiceId } })

    expect(response.status).toBe(409)
    expect(commandExecute).not.toHaveBeenCalled()
  })
})
