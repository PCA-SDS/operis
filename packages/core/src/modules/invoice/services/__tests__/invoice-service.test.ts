import { SortDir, type QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { E } from '#generated/entities.ids.generated'

import { Invoice, InvoiceCompany, InvoiceInstallment, InvoiceLineItem } from '../../data/entities'
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
    transactional: jest.fn(),
    create: jest.fn(),
    flush: jest.fn(),
    nativeDelete: jest.fn(),
  }
  const scopedPersistence = new InvoiceScopedPersistenceService(em as unknown as EntityManager)
  const service = new InvoiceService(
    em as unknown as EntityManager,
    queryEngine,
    scopedPersistence,
  )

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

  it('rejects Vietnamese partners for manual create before writing', async () => {
    const { em, service } = createService()

    await expect(service.createManualInvoice(scope, {
      partnerName: 'VN Seller',
      partnerCountryCode: 'VN',
      partnerTaxCode: '0100109106',
      invoiceNumber: 'INV-2',
      invoiceDate: '2026-01-10',
      lineItems: [{ name: 'Line', quantity: '1', unitPrice: '100' }],
    })).rejects.toMatchObject({ name: 'ZodError' })
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('guards manual duplicate invoices by scoped AP seller identity and symbol/number', async () => {
    const { em, service } = createService()
    jest.mocked(em.transactional).mockImplementation(async (work) => work(em as unknown as EntityManager))
    jest.mocked(em.findOne)
      .mockResolvedValueOnce({ id: scope.organizationId, name: 'Host Org' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(invoice())

    await expect(service.createManualInvoice(scope, {
      partnerName: 'Foreign Seller',
      partnerCountryCode: 'SG',
      partnerTaxCode: 'SG-123',
      invoiceSymbol: 'AA',
      invoiceNumber: 'INV-2',
      invoiceDate: '2026-01-10',
      lineItems: [{ name: 'Line', quantity: '1', unitPrice: '100' }],
    })).rejects.toMatchObject({ status: 409 })
  })

  it('creates manual AP invoice with server totals and auto-paid state', async () => {
    const { em, service } = createService()
    const seller = { id: companyId, taxCode: 'SG-123', name: 'Foreign Seller', countryCode: 'SG' } as InvoiceCompany
    jest.mocked(em.transactional).mockImplementation(async (work) => work(em as unknown as EntityManager))
    jest.mocked(em.findOne)
      .mockResolvedValueOnce({ id: scope.organizationId, name: 'Host Org' })
      .mockResolvedValueOnce(seller)
      .mockResolvedValueOnce(seller)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'rule-1' })
    jest.mocked(em.create).mockImplementation((_entity, payload) => payload)

    const result = await service.createManualInvoice(scope, {
      partnerName: 'Foreign Seller',
      partnerCountryCode: 'SG',
      partnerTaxCode: 'SG-123',
      invoiceNumber: 'INV-3',
      invoiceDate: '2026-01-10',
      grossAmount: '999999',
      paidAmount: '999999',
      lineItems: [{ name: 'Line', quantity: '2', unitPrice: '100', discountPercent: 10, vatRate: 10 }],
    })

    expect(result.invoice).toMatchObject({
      direction: 'AP',
      origin: 'MANUAL',
      buyerName: 'Host Org',
      buyerTaxCode: null,
      sellerName: 'Foreign Seller',
      grossAmount: '198.0000',
      paidAmount: '198.0000',
      outstandingAmount: '0',
      settlementStatus: 'SETTLED',
      autoSettled: true,
    })
    expect(JSON.stringify(result.invoice)).not.toContain('999999')
  })

  it('rejects update and delete for imported invoices', async () => {
    const { em, service } = createService()
    jest.mocked(em.transactional).mockImplementation(async (work) => work(em as unknown as EntityManager))
    jest.mocked(em.findOne).mockResolvedValue(invoice({ origin: 'GOVERNMENT_PORTAL' }))

    await expect(service.updateManualInvoice(scope, invoiceId, {
      partnerName: 'Foreign Seller',
      partnerCountryCode: 'SG',
      partnerTaxCode: 'SG-123',
      invoiceNumber: 'INV-4',
      invoiceDate: '2026-01-10',
      lineItems: [{ name: 'Line', quantity: '1', unitPrice: '100' }],
    })).rejects.toMatchObject({ status: 400 })
    await expect(service.deleteManualInvoice(scope, invoiceId)).rejects.toMatchObject({ status: 400 })
  })

  describe('updateDueDate', () => {
    it('sets a valid future due date on an unsettled invoice without an installment plan', async () => {
      const { em, service } = createService()
      const inv = invoice({
        invoiceDate: new Date('2026-01-10T00:00:00.000Z'),
        dueDate: null,
        settlementStatus: 'UNSETTLED',
        hasInstallmentPlan: false,
      })
      jest.mocked(em.findOne).mockResolvedValue(inv)
      jest.mocked(em.flush).mockResolvedValue(undefined)

      const result = await service.updateDueDate(scope, invoiceId, { dueDate: '2026-02-10' })

      expect(inv.dueDate).toEqual(new Date('2026-02-10T00:00:00.000Z'))
      expect(inv.dueDateSource).toBe('explicit')
      expect(inv.nextDueDate).toEqual(new Date('2026-02-10T00:00:00.000Z'))
      expect(result.invoice.dueDate).toBeTruthy()
      expect(em.flush).toHaveBeenCalled()
    })

    it('clears due date and nextDueDate when dueDate is null', async () => {
      const { em, service } = createService()
      const inv = invoice({
        invoiceDate: new Date('2026-01-10T00:00:00.000Z'),
        dueDate: new Date('2026-02-10T00:00:00.000Z'),
        nextDueDate: new Date('2026-02-10T00:00:00.000Z'),
        dueDateSource: 'explicit',
        settlementStatus: 'UNSETTLED',
        hasInstallmentPlan: false,
      })
      jest.mocked(em.findOne).mockResolvedValue(inv)
      jest.mocked(em.flush).mockResolvedValue(undefined)

      const result = await service.updateDueDate(scope, invoiceId, { dueDate: null })

      expect(inv.dueDate).toBeNull()
      expect(inv.dueDateSource).toBeNull()
      expect(inv.nextDueDate).toBeNull()
      expect(result.invoice.dueDate).toBeNull()
    })

    it('rejects a due date before invoice date with 400', async () => {
      const { em, service } = createService()
      jest.mocked(em.findOne).mockResolvedValue(invoice({
        invoiceDate: new Date('2026-01-10T00:00:00.000Z'),
        settlementStatus: 'UNSETTLED',
        hasInstallmentPlan: false,
      }))

      await expect(service.updateDueDate(scope, invoiceId, { dueDate: '2026-01-09' }))
        .rejects.toMatchObject({ status: 400 })
      expect(em.flush).not.toHaveBeenCalled()
    })

    it('rejects a due date beyond INVOICE_MAX_DUE_DAYS after invoice date with 400', async () => {
      const { em, service } = createService()
      jest.mocked(em.findOne).mockResolvedValue(invoice({
        invoiceDate: new Date('2026-01-10T00:00:00.000Z'),
        settlementStatus: 'UNSETTLED',
        hasInstallmentPlan: false,
      }))
      // INVOICE_MAX_DUE_DAYS = 3650; add 3651 days
      const tooFar = new Date('2026-01-10T00:00:00.000Z')
      tooFar.setDate(tooFar.getDate() + 3651)
      const tooFarStr = tooFar.toISOString().slice(0, 10)

      await expect(service.updateDueDate(scope, invoiceId, { dueDate: tooFarStr }))
        .rejects.toMatchObject({ status: 400 })
      expect(em.flush).not.toHaveBeenCalled()
    })

    it('does not update nextDueDate when invoice has an installment plan', async () => {
      const { em, service } = createService()
      const originalNextDueDate = new Date('2026-03-01T00:00:00.000Z')
      const inv = invoice({
        invoiceDate: new Date('2026-01-10T00:00:00.000Z'),
        dueDate: null,
        nextDueDate: originalNextDueDate,
        settlementStatus: 'UNSETTLED',
        hasInstallmentPlan: true,
      })
      jest.mocked(em.findOne).mockResolvedValue(inv)
      jest.mocked(em.flush).mockResolvedValue(undefined)

      await service.updateDueDate(scope, invoiceId, { dueDate: '2026-02-10' })

      expect(inv.nextDueDate).toEqual(originalNextDueDate)
    })

    it('sets nextDueDate to null for a settled invoice regardless of new due date', async () => {
      const { em, service } = createService()
      const inv = invoice({
        invoiceDate: new Date('2026-01-10T00:00:00.000Z'),
        dueDate: null,
        nextDueDate: null,
        settlementStatus: 'SETTLED',
        hasInstallmentPlan: false,
      })
      jest.mocked(em.findOne).mockResolvedValue(inv)
      jest.mocked(em.flush).mockResolvedValue(undefined)

      await service.updateDueDate(scope, invoiceId, { dueDate: '2026-02-10' })

      expect(inv.nextDueDate).toBeNull()
    })

    it('returns 404 for a missing or foreign-scope invoice', async () => {
      const { em, service } = createService()
      jest.mocked(em.findOne).mockResolvedValue(null)

      await expect(service.updateDueDate(scope, invoiceId, { dueDate: '2026-02-10' }))
        .rejects.toMatchObject({ status: 404 })
    })

    it('allows due-date update on imported (GOVERNMENT_PORTAL) invoices without touching tax data', async () => {
      const { em, service } = createService()
      const inv = invoice({
        origin: 'GOVERNMENT_PORTAL',
        invoiceDate: new Date('2026-01-10T00:00:00.000Z'),
        dueDate: null,
        settlementStatus: 'UNSETTLED',
        hasInstallmentPlan: false,
        sellerTaxCode: '0100109106',
        sellerName: 'Imported Seller',
      })
      jest.mocked(em.findOne).mockResolvedValue(inv)
      jest.mocked(em.flush).mockResolvedValue(undefined)

      await service.updateDueDate(scope, invoiceId, { dueDate: '2026-02-10' })

      expect(inv.dueDate).toEqual(new Date('2026-02-10T00:00:00.000Z'))
      // tax data unchanged
      expect(inv.sellerTaxCode).toBe('0100109106')
      expect(inv.sellerName).toBe('Imported Seller')
      expect(inv.origin).toBe('GOVERNMENT_PORTAL')
    })
  })
})
