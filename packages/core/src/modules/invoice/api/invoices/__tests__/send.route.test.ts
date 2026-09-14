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

import * as sendRoute from '../[id]/send/route'

const invoiceId = '11111111-1111-4111-8111-111111111111'
const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function createHarness(commandExecute = jest.fn()) {
  const commandBus = { execute: commandExecute }
  const container = {
    resolve: jest.fn((token: string) => token === 'commandBus' ? commandBus : undefined),
  } as unknown as AwilixContainer
  mockCreateRequestContainer.mockResolvedValue(container)
  mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: scope.tenantId, orgId: scope.organizationId })
  mockResolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: scope.organizationId })
  mockResolveTranslations.mockResolvedValue({ translate: (_key: string, fallback?: string) => fallback ?? 'error' })
  mockRunRouteMutationGuards.mockResolvedValue({ ok: true, modifiedPayload: null, runAfterSuccess: jest.fn() })
  return { commandBus }
}

describe('invoice send route', () => {
  beforeEach(() => jest.clearAllMocks())

  it('requires invoice.manage and exposes the send operation', () => {
    expect(sendRoute.metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['invoice.manage'] })
    expect(sendRoute.openApi.methods.POST?.operationId).toBe('invoice.invoices.send')
  })

  it('sends a validated recipient through the guarded command', async () => {
    const commandExecute = jest.fn().mockResolvedValue({ result: { invoice: { id: invoiceId }, invoiceId } })
    const { commandBus } = createHarness(commandExecute)
    const response = await sendRoute.POST(new Request(`https://example.test/api/invoice/invoices/${invoiceId}/send`, {
      method: 'POST',
      body: JSON.stringify({ email: 'customer@example.com' }),
      headers: { 'content-type': 'application/json' },
    }), { params: { id: invoiceId } })

    expect(response.status).toBe(200)
    expect(commandBus.execute).toHaveBeenCalledWith('invoice.invoices.send', expect.objectContaining({
      input: { id: invoiceId, input: { email: 'customer@example.com' } },
    }))
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ resourceKind: 'invoice.invoice', operation: 'update' }),
    }))
  })

  it('rejects invalid recipients without invoking the command', async () => {
    const commandExecute = jest.fn()
    createHarness(commandExecute)
    const response = await sendRoute.POST(new Request(`https://example.test/api/invoice/invoices/${invoiceId}/send`, {
      method: 'POST',
      body: JSON.stringify({ email: 'not-an-email' }),
    }), { params: { id: invoiceId } })

    expect(response.status).toBe(400)
    expect(commandExecute).not.toHaveBeenCalled()
  })
})
