import { sendEmail } from '@open-mercato/shared/lib/email/send'

import { Invoice, InvoiceLineItem } from '../../data/entities'
import type { InvoiceScope } from '../../data/scope'
import { InvoiceScopedPersistenceService } from '../scoped-persistence-service'
import { InvoiceService } from '../invoice-service'

jest.mock('@open-mercato/shared/lib/email/send', () => ({ sendEmail: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  detectLocale: jest.fn().mockResolvedValue('en'),
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, fallback?: string, values?: Record<string, string>) =>
      (fallback ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => values?.[name] ?? _match),
  }),
}))

const scope: InvoiceScope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const invoiceId = '11111111-1111-4111-8111-111111111111'
const companyId = '22222222-2222-4222-8222-222222222222'

function collection<T>(items: T[]) {
  return { getItems: () => items }
}

function buildInvoice(overrides: Partial<Invoice> = {}): Invoice {
  const lineItem = {
    id: '33333333-3333-4333-8333-333333333333',
    lineNumber: 1,
    name: 'Consulting',
    lineTotal: '120.0000',
  } as InvoiceLineItem
  return {
    id: invoiceId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    direction: 'AR',
    company: { id: companyId, name: 'Customer Ltd' },
    buyerName: 'Customer Ltd',
    sellerName: 'Our Company',
    invoiceNumber: 'AR-1001',
    invoiceDate: new Date('2026-01-10T00:00:00.000Z'),
    dueDate: new Date('2026-02-10T00:00:00.000Z'),
    currencyCode: 'VND',
    grossAmount: '120.0000',
    lineItems: collection([lineItem]),
    installments: collection([]),
    lastSentAt: null,
    emailTrackingTokenHash: null,
    openedAt: null,
    ...overrides,
  } as unknown as Invoice
}

function buildService(invoice: Invoice, companyEmailsService = { record: jest.fn().mockResolvedValue(null) }) {
  const em = {
    findOne: jest.fn().mockResolvedValue(invoice),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  const scopedPersistence = new InvoiceScopedPersistenceService(em as never)
  const service = new InvoiceService(
    em as never,
    {} as never,
    scopedPersistence,
    {} as never,
    companyEmailsService as never,
  )
  return { em, service, companyEmailsService }
}

describe('InvoiceService.sendInvoice', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.EMAIL_ASSET_BASE_URL = 'https://assets.example.test'
  })

  afterEach(() => {
    delete process.env.EMAIL_ASSET_BASE_URL
  })

  it('sends AR invoices before flushing state and stores only a token hash', async () => {
    const invoice = buildInvoice()
    const { em, service, companyEmailsService } = buildService(invoice)
    const callOrder: string[] = []
    jest.mocked(sendEmail).mockImplementation(async (options) => {
      callOrder.push('email')
      const rendered = JSON.stringify(options.react)
      expect(rendered).toContain('AR-1001')
      expect(rendered).toContain('Consulting')
      expect(rendered).toContain('https://assets.example.test/api/invoice/track/')
    })
    em.flush.mockImplementation(async () => {
      callOrder.push('flush')
    })

    const result = await service.sendInvoice(scope, invoiceId, { email: 'customer@example.com' })

    expect(callOrder).toEqual(['email', 'flush'])
    expect(invoice.emailTrackingTokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(invoice.lastSentAt).toBeInstanceOf(Date)
    expect(invoice.openedAt).toBeNull()
    expect(JSON.stringify(result.invoice)).not.toContain(invoice.emailTrackingTokenHash as string)
    expect(companyEmailsService.record).toHaveBeenCalledWith(scope, { companyId, email: 'customer@example.com' })
  })

  it('rejects AP invoices before sending mail', async () => {
    const { service, em } = buildService(buildInvoice({ direction: 'AP' }))

    await expect(service.sendInvoice(scope, invoiceId, { email: 'customer@example.com' })).rejects.toMatchObject({ status: 400 })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('leaves state and recipient memory unchanged when mail fails', async () => {
    const invoice = buildInvoice({ lastSentAt: null, emailTrackingTokenHash: 'a'.repeat(64), openedAt: new Date() })
    const { service, em, companyEmailsService } = buildService(invoice)
    jest.mocked(sendEmail).mockRejectedValue(new Error('provider failed'))

    await expect(service.sendInvoice(scope, invoiceId, { email: 'customer@example.com' })).rejects.toMatchObject({ status: 400 })
    expect(invoice.emailTrackingTokenHash).toBe('a'.repeat(64))
    expect(invoice.openedAt).toBeInstanceOf(Date)
    expect(em.flush).not.toHaveBeenCalled()
    expect(companyEmailsService.record).not.toHaveBeenCalled()
  })

  it('does not add a tracking pixel for an invalid asset base URL', async () => {
    process.env.EMAIL_ASSET_BASE_URL = 'javascript:alert(1)'
    const { service } = buildService(buildInvoice())
    jest.mocked(sendEmail).mockResolvedValue(undefined)

    await service.sendInvoice(scope, invoiceId, { email: 'customer@example.com' })

    expect(JSON.stringify(jest.mocked(sendEmail).mock.calls[0]?.[0]?.react)).not.toContain('/pixel.gif')
  })

  it('replaces the tracking hash and clears the first-open timestamp on resend', async () => {
    const invoice = buildInvoice({ emailTrackingTokenHash: 'b'.repeat(64), openedAt: new Date() })
    const { service } = buildService(invoice)
    jest.mocked(sendEmail).mockResolvedValue(undefined)

    await service.sendInvoice(scope, invoiceId, { email: 'customer@example.com' })
    const firstHash = invoice.emailTrackingTokenHash
    await service.sendInvoice(scope, invoiceId, { email: 'customer@example.com' })

    expect(firstHash).toMatch(/^[0-9a-f]{64}$/)
    expect(invoice.emailTrackingTokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(invoice.emailTrackingTokenHash).not.toBe('b'.repeat(64))
    expect(invoice.emailTrackingTokenHash).not.toBe(firstHash)
    expect(invoice.openedAt).toBeNull()
  })

  it('does not fail after recipient memory recording fails', async () => {
    const companyEmailsService = { record: jest.fn().mockRejectedValue(new Error('memory unavailable')) }
    const { service } = buildService(buildInvoice(), companyEmailsService)
    jest.mocked(sendEmail).mockResolvedValue(undefined)

    await expect(service.sendInvoice(scope, invoiceId, { email: 'customer@example.com' })).resolves.toMatchObject({
      invoice: { id: invoiceId },
    })
  })
})
