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
    invoiceDate: new Date('2026-09-01T00:00:00.000Z'),
    sellerTaxCode: 'SELLER-TAX',
    buyerTaxCode: 'BUYER-TAX',
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

function buildIncomingHarness(options: {
  receiver?: Invoice | null
  confirmations?: Array<Record<string, unknown>>
  changed?: number
} = {}) {
  const receiver = options.receiver === undefined
    ? buildInvoice({ direction: 'AR', lineItems: [] as never, installments: [] as never })
    : options.receiver
  const payerInvoice = buildInvoice({
    id: '55555555-5555-4555-8555-555555555555',
    tenantId: 'payer-tenant',
    organizationId: 'payer-organization',
  })
  const confirmations = options.confirmations ?? [{
    id: confirmationId,
    tenantId: payerInvoice.tenantId,
    organizationId: payerInvoice.organizationId,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000),
    installment: null,
    invoice: payerInvoice,
  }]
  const applyInvoicePayment = jest.fn(async () => undefined)
  const updateReceivableSettlement = jest.fn(async () => ({
    invoice: {
      id: receiver?.id,
      direction: 'AR',
      settlementStatus: 'SETTLED',
    },
  }))
  const transactionInvoiceService = { applyInvoicePayment, updateReceivableSettlement }
  const invoiceService = {
    forTransaction: jest.fn(() => transactionInvoiceService),
  }
  const tx = {
    findOne: jest.fn(async () => receiver),
    find: jest.fn(async () => confirmations),
    nativeUpdate: jest.fn(async () => options.changed ?? 1),
  }
  const em = {
    transactional: jest.fn(async (work: (manager: typeof tx) => Promise<unknown>) => work(tx)),
  }
  const service = new InvoicePaymentConfirmationsService(em as never, {} as never, invoiceService as never)

  return {
    service,
    tx,
    invoiceService,
    applyInvoicePayment,
    updateReceivableSettlement,
    payerInvoice,
    receiver,
  }
}

describe('InvoicePaymentConfirmationsService incoming actions', () => {
  beforeEach(() => jest.clearAllMocks())

  it('accepts one matching whole-invoice claim and settles both invoice sides through InvoiceService', async () => {
    const harness = buildIncomingHarness()

    await expect(harness.service.acceptIncoming(scope, invoiceId)).resolves.toMatchObject({
      confirmationId,
      status: 'CONFIRMED',
      invoice: { id: invoiceId, direction: 'AR', settlementStatus: 'SETTLED' },
    })
    expect(harness.tx.findOne).toHaveBeenCalledWith(expect.any(Function), {
      id: invoiceId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    }, expect.any(Object))
    expect(harness.tx.find).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      status: 'PENDING',
      expiresAt: { $gt: expect.any(Date) },
      installment: null,
      invoice: expect.objectContaining({
        direction: 'AP',
        deletedAt: null,
        sellerTaxCode: 'SELLER-TAX',
        buyerTaxCode: 'BUYER-TAX',
        invoiceSymbol: 'AA/26E',
        invoiceNumber: '1001',
        invoiceDate: new Date('2026-09-01T00:00:00.000Z'),
      }),
    }), expect.objectContaining({ limit: 2 }))
    expect(harness.tx.nativeUpdate).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      id: confirmationId,
      status: 'PENDING',
      expiresAt: { $gt: expect.any(Date) },
    }), expect.objectContaining({ status: 'CONFIRMED' }))
    expect(harness.invoiceService.forTransaction).toHaveBeenCalledWith(harness.tx)
    expect(harness.applyInvoicePayment).toHaveBeenCalledWith({
      tenantId: 'payer-tenant',
      organizationId: 'payer-organization',
    }, harness.payerInvoice.id)
    expect(harness.updateReceivableSettlement).toHaveBeenCalledWith(scope, invoiceId, { settled: true })
  })

  it('rejects a matching claim without changing either invoice', async () => {
    const harness = buildIncomingHarness()

    await expect(harness.service.rejectIncoming(scope, invoiceId)).resolves.toMatchObject({
      confirmationId,
      status: 'REJECTED',
      invoice: { id: invoiceId, direction: 'AR' },
    })
    expect(harness.tx.nativeUpdate).toHaveBeenCalledWith(expect.any(Function), expect.any(Object), expect.objectContaining({
      status: 'REJECTED',
    }))
    expect(harness.invoiceService.forTransaction).not.toHaveBeenCalled()
  })

  it('rejects an AP receiver before searching for an incoming claim', async () => {
    const harness = buildIncomingHarness({ receiver: buildInvoice() })

    await expect(harness.service.acceptIncoming(scope, invoiceId)).rejects.toMatchObject({ status: 400 })
    expect(harness.tx.find).not.toHaveBeenCalled()
  })

  it.each([
    ['no match', []],
    ['ambiguous matches', [{ id: 'one' }, { id: 'two' }]],
  ])('returns conflict for %s', async (_label, confirmations) => {
    const harness = buildIncomingHarness({ confirmations })

    await expect(harness.service.acceptIncoming(scope, invoiceId)).rejects.toMatchObject({ status: 409 })
    expect(harness.tx.nativeUpdate).not.toHaveBeenCalled()
    expect(harness.applyInvoicePayment).not.toHaveBeenCalled()
  })

  it('returns conflict when a concurrent action wins the pending transition', async () => {
    const harness = buildIncomingHarness({ changed: 0 })

    await expect(harness.service.acceptIncoming(scope, invoiceId)).rejects.toMatchObject({ status: 409 })
    expect(harness.applyInvoicePayment).not.toHaveBeenCalled()
    expect(harness.updateReceivableSettlement).not.toHaveBeenCalled()
  })
})
