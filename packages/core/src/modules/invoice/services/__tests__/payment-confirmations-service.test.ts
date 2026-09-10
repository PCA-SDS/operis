import { createHash } from 'node:crypto'
import { sendEmail } from '@open-mercato/shared/lib/email/send'

import type { Invoice, InvoiceInstallment } from '../../data/entities'
import { emitInvoiceEvent } from '../../events'
import { InvoicePaymentConfirmationsService } from '../payment-confirmations-service'

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  detectLocale: jest.fn(async () => 'en'),
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (message, [key, value]) => message.replaceAll(`{${key}}`, value),
        fallback,
      ),
  })),
}))
jest.mock('@open-mercato/shared/lib/url', () => ({
  getSecurityEmailBaseUrl: jest.fn(() => 'https://app.example.test'),
}))
jest.mock('../../events', () => ({
  emitInvoiceEvent: jest.fn(async () => undefined),
}))

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const invoiceId = '11111111-1111-4111-8111-111111111111'
const companyId = '22222222-2222-4222-8222-222222222222'
const confirmationId = '33333333-3333-4333-8333-333333333333'
const installmentId = '44444444-4444-4444-8444-444444444444'

function buildInstallment(overrides: Partial<InvoiceInstallment> = {}): InvoiceInstallment {
  return {
    id: installmentId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    sequence: 2,
    totalAmount: '40.0000',
    status: 'PENDING',
    ...overrides,
  } as InvoiceInstallment
}

function buildInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: invoiceId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    direction: 'AP',
    settlementStatus: 'UNSETTLED',
    invoiceSymbol: 'AA/26E',
    invoiceNumber: '1001',
    buyerName: 'Buyer Company',
    sellerName: 'Supplier Company',
    currencyCode: 'USD',
    grossAmount: '100.0000',
    outstandingAmount: '60.0000',
    company: { id: companyId, name: 'Supplier Company' },
    installments: [],
    ...overrides,
  } as unknown as Invoice
}

function buildService(invoice: Invoice | null) {
  let committed = false
  const callOrder: string[] = []
  const tx: Record<string, jest.Mock> = {
    findOne: jest.fn(async () => invoice),
    create: jest.fn((_entity, payload) => ({ id: confirmationId, ...payload })),
    persist: jest.fn(() => tx),
    flush: jest.fn(async () => {
      callOrder.push('create')
    }),
    nativeDelete: jest.fn(async () => {
      callOrder.push('supersede')
      return 1
    }),
  }
  const em = {
    transactional: jest.fn(async (work: (manager: typeof tx) => Promise<unknown>) => {
      const result = await work(tx)
      committed = true
      return result
    }),
  }
  const companyEmailsService = {
    record: jest.fn(async () => null),
  }
  const service = new InvoicePaymentConfirmationsService(
    em as never,
    companyEmailsService as never,
  )

  return {
    service,
    tx,
    callOrder,
    companyEmailsService,
    wasCommitted: () => committed,
  }
}

describe('InvoicePaymentConfirmationsService.request', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(sendEmail).mockImplementation(async () => undefined)
  })

  it('creates a scoped whole-invoice request, emails the raw token, and persists only its hash', async () => {
    const harness = buildService(buildInvoice())
    jest.mocked(sendEmail).mockImplementation(async (options) => {
      harness.callOrder.push('email')
      expect(JSON.stringify(options.react)).toContain('60.0000 USD')
    })

    const result = await harness.service.request(scope, {
      invoiceId,
      recipientEmail: 'supplier@example.com',
    })

    const persisted = harness.tx.create.mock.calls[0]?.[1] as Record<string, unknown>
    const renderedEmail = JSON.stringify(jest.mocked(sendEmail).mock.calls[0]?.[0]?.react)
    const rawToken = renderedEmail.match(/confirm-payment\/([0-9a-f]{64})/)?.[1]
    expect(rawToken).toBeDefined()
    expect(persisted.tokenHash).toBe(createHash('sha256').update(rawToken as string).digest('hex'))
    expect(JSON.stringify(persisted)).not.toContain(rawToken as string)
    expect(JSON.stringify(result)).not.toContain(rawToken as string)
    expect(result).toMatchObject({
      confirmationId,
      invoiceId,
      installmentId: null,
      status: 'PENDING',
    })
    expect(harness.callOrder).toEqual(['create', 'email', 'supersede'])
    expect(harness.tx.findOne).toHaveBeenCalledWith(expect.any(Function), {
      id: invoiceId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    }, expect.any(Object))
    expect(harness.tx.nativeDelete).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      id: { $ne: confirmationId },
      installment: null,
      status: 'PENDING',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }))
    expect(harness.companyEmailsService.record).toHaveBeenCalledWith(scope, {
      companyId,
      email: 'supplier@example.com',
    })
    expect(emitInvoiceEvent).toHaveBeenCalledWith('invoice.payment_confirmation.requested', expect.objectContaining({
      id: confirmationId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }))
  })

  it('uses the installment amount and supersedes only the same installment target', async () => {
    const installment = buildInstallment()
    const harness = buildService(buildInvoice({ installments: [installment] as never }))
    jest.mocked(sendEmail).mockImplementation(async (options) => {
      expect(JSON.stringify(options.react)).toContain('40.0000 USD')
      expect(JSON.stringify(options.react)).toContain('Installment 2')
    })

    await harness.service.request(scope, {
      invoiceId,
      recipientEmail: 'supplier@example.com',
      installmentId,
    })

    expect(harness.tx.nativeDelete).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      installment,
      status: 'PENDING',
    }))
  })

  it.each([
    ['AR invoice', buildInvoice({ direction: 'AR' }), 400],
    ['settled invoice', buildInvoice({ settlementStatus: 'SETTLED' }), 400],
    ['foreign or missing invoice', null, 404],
  ])('rejects an invalid %s before sending mail', async (_label, invoice, status) => {
    const harness = buildService(invoice)

    await expect(harness.service.request(scope, {
      invoiceId,
      recipientEmail: 'supplier@example.com',
    })).rejects.toMatchObject({ status })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(harness.tx.create).not.toHaveBeenCalled()
  })

  it.each([
    ['missing installment', []],
    ['different installment', [buildInstallment({ id: '55555555-5555-4555-8555-555555555555' })]],
  ])('rejects a %s', async (_label, installments) => {
    const harness = buildService(buildInvoice({ installments: installments as never }))

    await expect(harness.service.request(scope, {
      invoiceId,
      recipientEmail: 'supplier@example.com',
      installmentId,
    })).rejects.toMatchObject({ status: 404 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('rejects a paid installment', async () => {
    const harness = buildService(buildInvoice({
      installments: [buildInstallment({ status: 'PAID' })] as never,
    }))

    await expect(harness.service.request(scope, {
      invoiceId,
      recipientEmail: 'supplier@example.com',
      installmentId,
    })).rejects.toMatchObject({ status: 400 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('rolls back the new request and keeps previous requests when mail delivery fails', async () => {
    const harness = buildService(buildInvoice())
    jest.mocked(sendEmail).mockRejectedValue(new Error('provider failed'))

    await expect(harness.service.request(scope, {
      invoiceId,
      recipientEmail: 'supplier@example.com',
    })).rejects.toMatchObject({ status: 400 })
    expect(harness.wasCommitted()).toBe(false)
    expect(harness.tx.nativeDelete).not.toHaveBeenCalled()
    expect(harness.companyEmailsService.record).not.toHaveBeenCalled()
    expect(emitInvoiceEvent).not.toHaveBeenCalled()
  })

  it('does not fail when recipient memory cannot be recorded', async () => {
    const harness = buildService(buildInvoice())
    harness.companyEmailsService.record.mockRejectedValue(new Error('memory unavailable'))

    await expect(harness.service.request(scope, {
      invoiceId,
      recipientEmail: 'supplier@example.com',
    })).resolves.toMatchObject({ confirmationId, status: 'PENDING' })
    expect(emitInvoiceEvent).toHaveBeenCalled()
  })
})
