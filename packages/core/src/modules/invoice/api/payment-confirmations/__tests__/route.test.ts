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

import * as requestRoute from '../route'
import * as acceptRoute from '../../invoices/[id]/incoming-confirmation/accept/route'
import * as rejectRoute from '../../invoices/[id]/incoming-confirmation/reject/route'

const invoiceId = '11111111-1111-4111-8111-111111111111'
const confirmationId = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

const invoice = {
  id: invoiceId,
  sourceInvoiceId: 'source-1',
  origin: 'GOVERNMENT_PORTAL',
  direction: 'AR',
  companyId: '33333333-3333-4333-8333-333333333333',
  partnerName: 'Buyer',
  partnerTaxCode: 'BUYER-TAX',
  sellerTaxCode: 'SELLER-TAX',
  sellerName: 'Seller',
  buyerTaxCode: 'BUYER-TAX',
  buyerName: 'Buyer',
  invoiceSymbol: 'AA/26E',
  invoiceNumber: '1001',
  invoiceCode: null,
  invoiceDate: '2026-09-01T00:00:00.000Z',
  dueDate: null,
  dueDateSource: null,
  currencyCode: 'VND',
  invoiceStatus: 'ACTIVE',
  netAmount: '100.0000',
  vatAmount: '0.0000',
  grossAmount: '100.0000',
  hasReceived: true,
  hasPaid: false,
  settlementStatus: 'SETTLED',
  settled: true,
  paidAmount: '100.0000',
  outstandingAmount: '0.0000',
  nextDueDate: null,
  hasInstallmentPlan: false,
  nonRecoverable: false,
  nonRecoverableNote: null,
  nonRecoverableAt: null,
  lastSentAt: null,
  openedAt: null,
  autoSettled: false,
  autoPayExcluded: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
  lineItems: [],
  installments: [],
}

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
  mockRunRouteMutationGuards.mockResolvedValue({ ok: true, modifiedPayload: null, runAfterSuccess })
  return { commandBus, runAfterSuccess }
}

describe('authenticated payment confirmation routes', () => {
  beforeEach(() => jest.clearAllMocks())

  it('requires the payment confirmation feature and exposes stable OpenAPI operations', () => {
    const required = {
      requireAuth: true,
      requireFeatures: ['invoice.payment_confirmations.manage'],
    }
    expect(requestRoute.metadata.POST).toEqual(required)
    expect(acceptRoute.metadata.POST).toEqual(required)
    expect(rejectRoute.metadata.POST).toEqual(required)
    expect(requestRoute.openApi.methods.POST?.operationId).toBe('invoice.paymentConfirmations.request')
    expect(acceptRoute.openApi.methods.POST?.operationId).toBe('invoice.paymentConfirmations.incoming.accept')
    expect(rejectRoute.openApi.methods.POST?.operationId).toBe('invoice.paymentConfirmations.incoming.reject')
  })

  it('requests a confirmation through a guarded command', async () => {
    const result = {
      confirmationId,
      invoiceId,
      installmentId: null,
      status: 'PENDING',
      expiresAt: '2026-09-24T00:00:00.000Z',
    }
    const commandExecute = jest.fn().mockResolvedValue({ result })
    const { commandBus, runAfterSuccess } = createHarness(commandExecute)
    const response = await requestRoute.POST(new Request('https://example.test/api/invoice/payment-confirmations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invoiceId, recipientEmail: 'supplier@example.com' }),
    }))

    expect(response.status).toBe(200)
    expect(commandBus.execute).toHaveBeenCalledWith('invoice.payment_confirmations.request', expect.objectContaining({
      input: { invoiceId, recipientEmail: 'supplier@example.com' },
    }))
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ resourceKind: 'invoice.payment_confirmation', operation: 'create' }),
    }))
    expect(runAfterSuccess).toHaveBeenCalled()
  })

  it.each([
    ['accept', acceptRoute, 'invoice.payment_confirmations.accept-incoming', 'CONFIRMED'],
    ['reject', rejectRoute, 'invoice.payment_confirmations.reject-incoming', 'REJECTED'],
  ])('routes incoming %s through a guarded command', async (_label, route, commandId, status) => {
    const commandExecute = jest.fn().mockResolvedValue({
      result: { confirmationId, status, invoice },
    })
    const { commandBus } = createHarness(commandExecute)
    const response = await route.POST(new Request(`https://example.test/api/invoice/invoices/${invoiceId}/incoming-confirmation/${_label}`, {
      method: 'POST',
    }), { params: { id: invoiceId } })

    expect(response.status).toBe(200)
    expect(commandBus.execute).toHaveBeenCalledWith(commandId, expect.objectContaining({
      input: { invoiceId },
    }))
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ resourceKind: 'invoice.invoice', resourceId: invoiceId, operation: 'update' }),
    }))
  })

  it('rejects invalid request input before invoking the command', async () => {
    const commandExecute = jest.fn()
    createHarness(commandExecute)
    const response = await requestRoute.POST(new Request('https://example.test/api/invoice/payment-confirmations', {
      method: 'POST',
      body: JSON.stringify({ invoiceId, recipientEmail: 'invalid' }),
    }))

    expect(response.status).toBe(400)
    expect(commandExecute).not.toHaveBeenCalled()
  })
})
