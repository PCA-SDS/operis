import { SortDir, type QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { E } from '#generated/entities.ids.generated'

import { Invoice, InvoiceInstallment, InvoiceLineItem } from '../../data/entities'
import type { InvoiceScope } from '../../data/scope'
import { InvoiceScopedPersistenceService } from '../scoped-persistence-service'
import { InvoiceService } from '../invoice-service'

const scope: InvoiceScope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const invoiceId = '11111111-1111-4111-8111-111111111111'
const companyId = '22222222-2222-4222-8222-222222222222'

function queryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: invoiceId,
    source_invoice_id: 'source-1',
    origin: 'GOVERNMENT_PORTAL',
    direction: 'AP',
    company_id: companyId,
    seller_tax_code: '0100109106',
    seller_name: 'Supplier',
    buyer_tax_code: '0301448888',
    buyer_name: 'Buyer',
    invoice_number: 'INV-1',
    invoice_date: new Date('2026-01-10T00:00:00.000Z'),
    due_date: new Date('2026-02-10T00:00:00.000Z'),
    currency_code: 'VND',
    invoice_status: 'ACTIVE',
    gross_amount: '120.0000',
    has_received: false,
    has_paid: false,
    settlement_status: 'UNSETTLED',
    paid_amount: '0',
    outstanding_amount: '120.0000',
    has_installment_plan: false,
    non_recoverable: false,
    auto_settled: false,
    auto_pay_excluded: false,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-02T00:00:00.000Z'),
    email_tracking_token_hash: 'secret-hash',
    tokenHash: 'secret-payment-hash',
    ...overrides,
  }
}

function lineItem(overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    lineNumber: 1,
    name: 'Line',
    lineTotal: '120.0000',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  } as InvoiceLineItem
}

function installment(overrides: Partial<InvoiceInstallment> = {}): InvoiceInstallment {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    sequence: 1,
    principalAmount: '120.0000',
    interestRate: '0',
    interestAmount: '0',
    totalAmount: '120.0000',
    dueDate: new Date('2026-02-10T00:00:00.000Z'),
    status: 'PENDING',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  } as InvoiceInstallment
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: invoiceId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    sourceInvoiceId: 'source-1',
    origin: 'GOVERNMENT_PORTAL',
    direction: 'AP',
    company: { id: companyId },
    sellerTaxCode: '0100109106',
    sellerName: 'Supplier',
    buyerTaxCode: '0301448888',
    buyerName: 'Buyer',
    invoiceNumber: 'INV-1',
    invoiceDate: new Date('2026-01-10T00:00:00.000Z'),
    dueDate: new Date('2026-02-10T00:00:00.000Z'),
    currencyCode: 'VND',
    invoiceStatus: 'ACTIVE',
    grossAmount: '120.0000',
    hasReceived: false,
    hasPaid: false,
    settlementStatus: 'UNSETTLED',
    paidAmount: '0',
    outstandingAmount: '120.0000',
    hasInstallmentPlan: true,
    nonRecoverable: false,
    autoSettled: false,
    autoPayExcluded: false,
    searchText: '',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    lineItems: [
      lineItem({ id: '33333333-3333-4333-8333-333333333334', lineNumber: 2 }),
      lineItem({ id: '33333333-3333-4333-8333-333333333333', lineNumber: 1 }),
    ],
    installments: [
      installment({ id: '44444444-4444-4444-8444-444444444445', sequence: 2 }),
      installment({ id: '44444444-4444-4444-8444-444444444444', sequence: 1 }),
    ],
    emailTrackingTokenHash: 'secret-hash',
    ...overrides,
  } as unknown as Invoice
}

function createService() {
  const queryEngine = {
    query: jest.fn(),
  } as unknown as QueryEngine
  const em = {
    findOne: jest.fn(),
  }
  const scopedPersistence = new InvoiceScopedPersistenceService(em as unknown as EntityManager)
  const service = new InvoiceService(queryEngine, scopedPersistence)

  return { em, queryEngine, service }
}

describe('InvoiceService', () => {
  it('lists invoices through QueryEngine with trusted scope, safe fields, filters, page, and stable sort', async () => {
    const { queryEngine, service } = createService()
    jest.mocked(queryEngine.query).mockResolvedValue({
      items: [queryRow()],
      total: 1,
      page: 2,
      pageSize: 10,
    })

    const result = await service.listInvoices(scope, {
      page: 2,
      pageSize: 10,
      direction: 'AP',
      status: 'ACTIVE',
      settlement: 'unsettled',
      recoverability: 'recoverable',
      partnerId: companyId,
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
      search: 'INV',
      tenantId: 'forged',
      organizationId: 'forged',
    })

    expect(queryEngine.query).toHaveBeenCalledWith(E.invoice.invoice, expect.objectContaining({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      fields: expect.not.arrayContaining(['email_tracking_token_hash', 'token_hash']),
      filters: expect.objectContaining({
        direction: { $eq: 'AP' },
        invoice_status: { $eq: 'ACTIVE' },
        settlement_status: { $ne: 'SETTLED' },
        non_recoverable: { $eq: false },
        company_id: { $eq: companyId },
        $or: expect.any(Array),
      }),
      sort: [
        { field: 'invoice_date', dir: SortDir.Desc },
        { field: 'id', dir: SortDir.Asc },
      ],
      page: { page: 2, pageSize: 10 },
    }))
    expect(result.items[0]).toMatchObject({
      id: invoiceId,
      partnerName: 'Supplier',
      partnerTaxCode: '0100109106',
      settled: false,
    })
    expect(JSON.stringify(result)).not.toContain('emailTrackingTokenHash')
    expect(JSON.stringify(result)).not.toContain('tokenHash')
    expect(JSON.stringify(result)).not.toContain('secret-hash')
  })

  it('allows only known sort fields and adds id as the tie-breaker', async () => {
    const { queryEngine, service } = createService()
    jest.mocked(queryEngine.query).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })

    await service.listInvoices(scope, { sortField: 'invoiceNumber', sortDir: 'asc' })

    expect(jest.mocked(queryEngine.query).mock.calls[0]?.[1]).toMatchObject({
      sort: [
        { field: 'invoice_number', dir: SortDir.Asc },
        { field: 'id', dir: SortDir.Asc },
      ],
    })
    await expect(service.listInvoices(scope, { sortField: 'sellerTaxCode' })).rejects.toMatchObject({ name: 'ZodError' })
  })

  it('loads detail through scoped persistence and returns ordered child rows without sensitive fields', async () => {
    const { em, service } = createService()
    jest.mocked(em.findOne).mockResolvedValue(invoice())

    const result = await service.getInvoiceDetail(scope, invoiceId)

    expect(em.findOne).toHaveBeenCalledWith(Invoice, {
      id: invoiceId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    }, expect.objectContaining({
      populate: ['company', 'lineItems', 'installments'],
    }))
    expect(result.lineItems.map((item) => item.lineNumber)).toEqual([1, 2])
    expect(result.installments.map((item) => item.sequence)).toEqual([1, 2])
    expect(JSON.stringify(result)).not.toContain('emailTrackingTokenHash')
    expect(JSON.stringify(result)).not.toContain('tokenHash')
    expect(JSON.stringify(result)).not.toContain('secret-hash')
  })

  it('returns 404 for missing or foreign invoice detail', async () => {
    const { em, service } = createService()
    jest.mocked(em.findOne).mockResolvedValue(null)

    await expect(service.getInvoiceDetail(scope, invoiceId)).rejects.toMatchObject({ status: 404 })
  })
})
