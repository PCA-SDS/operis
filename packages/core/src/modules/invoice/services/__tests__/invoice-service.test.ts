import { SortDir, type QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { E } from '#generated/entities.ids.generated'

import { Invoice, InvoiceCompany, InvoiceInstallment, InvoiceLineItem } from '../../data/entities'
import type { InvoiceScope } from '../../data/scope'
import { InvoiceScopedPersistenceService } from '../scoped-persistence-service'
import { InvoiceService } from '../invoice-service'
import {
  InvoiceExchangeRatesService,
  InvoiceExchangeRatesUnavailableError,
  type InvoiceExchangeRatesDto,
} from '../exchange-rates-service'

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

function createService(exchangeRatesService?: InvoiceExchangeRatesService) {
  const queryEngine = {
    query: jest.fn(),
  } as unknown as QueryEngine
  const em = {
    find: jest.fn(),
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
    exchangeRatesService,
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
        installments: [] as unknown as Invoice['installments'],
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

    it('allows due-date update on manual invoices', async () => {
      const { em, service } = createService()
      const inv = invoice({
        origin: 'MANUAL',
        invoiceDate: new Date('2026-01-10T00:00:00.000Z'),
        dueDate: null,
        settlementStatus: 'UNSETTLED',
        hasInstallmentPlan: false,
        installments: [] as unknown as Invoice['installments'],
      })
      jest.mocked(em.findOne).mockResolvedValue(inv)
      jest.mocked(em.flush).mockResolvedValue(undefined)

      await service.updateDueDate(scope, invoiceId, { dueDate: '2026-02-10' })

      expect(inv.origin).toBe('MANUAL')
      expect(inv.dueDate).toEqual(new Date('2026-02-10T00:00:00.000Z'))
      expect(inv.nextDueDate).toEqual(new Date('2026-02-10T00:00:00.000Z'))
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
        installments: [] as unknown as Invoice['installments'],
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

    it('does not update nextDueDate when installment rows exist even if the flag is stale', async () => {
      const { em, service } = createService()
      const originalNextDueDate = new Date('2026-03-01T00:00:00.000Z')
      const inv = invoice({
        invoiceDate: new Date('2026-01-10T00:00:00.000Z'),
        dueDate: null,
        nextDueDate: originalNextDueDate,
        settlementStatus: 'UNSETTLED',
        hasInstallmentPlan: false,
        installments: [installment()] as unknown as Invoice['installments'],
      })
      jest.mocked(em.findOne).mockResolvedValue(inv)
      jest.mocked(em.flush).mockResolvedValue(undefined)

      await service.updateDueDate(scope, invoiceId, { dueDate: '2026-02-10' })

      expect(inv.dueDate).toEqual(new Date('2026-02-10T00:00:00.000Z'))
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

  describe('getSummary', () => {
    it('aggregates AP and AR independently in VND and treats VND rate as 1 without calling FX service', async () => {
      const mockFx = { getRates: jest.fn() } as unknown as InvoiceExchangeRatesService
      const { em, service } = createService(mockFx)

      const ar1 = invoice({
        id: 'ar-1',
        direction: 'AR',
        currencyCode: 'VND',
        settlementStatus: 'UNSETTLED',
        paidAmount: '0.0000',
        outstandingAmount: '1000000.0000',
        nonRecoverable: false,
      })
      const ar2 = invoice({
        id: 'ar-2',
        direction: 'AR',
        currencyCode: 'VND',
        settlementStatus: 'SETTLED',
        paidAmount: '500000.0000',
        outstandingAmount: '0.0000',
        nonRecoverable: false,
      })
      const ap1 = invoice({
        id: 'ap-1',
        direction: 'AP',
        currencyCode: 'VND',
        settlementStatus: 'UNSETTLED',
        paidAmount: '0.0000',
        outstandingAmount: '400000.0000',
      })

      jest.mocked(em.find).mockResolvedValue([ar1, ar2, ap1])

      const summary = await service.getSummary(scope)

      expect(mockFx.getRates).not.toHaveBeenCalled()
      expect(summary.currency).toBe('VND')
      expect(summary.ratesStale).toBe(false)
      expect(summary.ar.outstanding).toBe('1000000.0000')
      expect(summary.ar.settled).toBe('500000.0000')
      expect(summary.ap.outstanding).toBe('400000.0000')
      expect(summary.ap.settled).toBe('0.0000')
      expect(summary.netPosition).toBe('600000.0000') // 1000000 - 400000
    })

    it('excludes non-recoverable AR from collectable totals and reports nonRecoverableAmount', async () => {
      const { em, service } = createService()

      const arActive = invoice({
        id: 'ar-1',
        direction: 'AR',
        currencyCode: 'VND',
        settlementStatus: 'UNSETTLED',
        paidAmount: '0.0000',
        outstandingAmount: '1000.0000',
        nonRecoverable: false,
      })
      const arWrittenOff = invoice({
        id: 'ar-2',
        direction: 'AR',
        currencyCode: 'VND',
        settlementStatus: 'UNSETTLED',
        paidAmount: '0.0000',
        outstandingAmount: '2000.0000',
        nonRecoverable: true,
      })

      jest.mocked(em.find).mockResolvedValue([arActive, arWrittenOff])

      const summary = await service.getSummary(scope)

      expect(summary.ar.outstanding).toBe('1000.0000')
      expect(summary.ar.nonRecoverableAmount).toBe('2000.0000')
      expect(summary.netPosition).toBe('1000.0000')
    })

    it('normalizes foreign currencies to VND using exchangeRatesService', async () => {
      const mockFx = {
        getRates: jest.fn().mockResolvedValue({
          baseCurrency: 'VND',
          fetchedAt: '2026-09-09T00:00:00.000Z',
          stale: false,
          rates: {
            USD: { currencyCode: 'USD', vndPerUnit: 25000 },
            VND: { currencyCode: 'VND', vndPerUnit: 1 },
          },
        }),
      } as unknown as InvoiceExchangeRatesService
      const { em, service } = createService(mockFx)

      const arUsd = invoice({
        id: 'ar-usd',
        direction: 'AR',
        currencyCode: 'USD',
        settlementStatus: 'UNSETTLED',
        paidAmount: '0.0000',
        outstandingAmount: '100.0000',
        nonRecoverable: false,
      })

      jest.mocked(em.find).mockResolvedValue([arUsd])

      const summary = await service.getSummary(scope)

      expect(mockFx.getRates).toHaveBeenCalledTimes(1)
      expect(summary.ar.outstanding).toBe('2500000.0000') // 100 * 25000
      expect(summary.netPosition).toBe('2500000.0000')
    })

    it('fails with InvoiceExchangeRatesUnavailableError when FX provider fails and no cache exists', async () => {
      const mockFx = {
        getRates: jest.fn().mockRejectedValue(new InvoiceExchangeRatesUnavailableError('Provider down')),
      } as unknown as InvoiceExchangeRatesService
      const { em, service } = createService(mockFx)

      const arUsd = invoice({
        id: 'ar-usd',
        direction: 'AR',
        currencyCode: 'USD',
        outstandingAmount: '100.0000',
      })

      jest.mocked(em.find).mockResolvedValue([arUsd])

      await expect(service.getSummary(scope)).rejects.toThrow(InvoiceExchangeRatesUnavailableError)
    })
  })

  describe('getForecast', () => {
    it('forecasts using installments when plan exists and uses invoice dueDate when no plan', async () => {
      const { em, service } = createService()

      const invWithPlan = invoice({
        id: 'inv-plan',
        direction: 'AR',
        currencyCode: 'VND',
        settlementStatus: 'PARTIALLY_PAID',
        hasInstallmentPlan: true,
        dueDate: new Date('2026-05-01T00:00:00.000Z'),
        installments: [
          installment({
            id: 'inst-1',
            sequence: 1,
            totalAmount: '300.0000',
            dueDate: new Date('2026-03-15T00:00:00.000Z'),
            status: 'PAID', // should be excluded
          }),
          installment({
            id: 'inst-2',
            sequence: 2,
            totalAmount: '700.0000',
            dueDate: new Date('2026-04-15T00:00:00.000Z'),
            status: 'PENDING', // included
          }),
        ],
      })

      const invNoPlan = invoice({
        id: 'inv-no-plan',
        direction: 'AP',
        currencyCode: 'VND',
        settlementStatus: 'UNSETTLED',
        hasInstallmentPlan: false,
        installments: [],
        dueDate: new Date('2026-04-20T00:00:00.000Z'),
        outstandingAmount: '500.0000',
      })

      jest.mocked(em.find).mockResolvedValue([invWithPlan, invNoPlan])

      const forecast = await service.getForecast(scope, { throughDate: '2026-12-31' })

      expect(forecast.currency).toBe('VND')
      expect(forecast.entries).toHaveLength(2)
      // First entry: pending installment on 2026-04-15
      expect(forecast.entries[0]).toEqual(expect.objectContaining({
        date: '2026-04-15',
        direction: 'AR',
        amountVnd: '700.0000',
        invoiceId: 'inv-plan',
        installmentId: 'inst-2',
      }))
      // Second entry: invoice due date on 2026-04-20
      expect(forecast.entries[1]).toEqual(expect.objectContaining({
        date: '2026-04-20',
        direction: 'AP',
        amountVnd: '500.0000',
        invoiceId: 'inv-no-plan',
        installmentId: null,
      }))
      expect(forecast.totals).toEqual({
        arAmount: '700.0000',
        apAmount: '500.0000',
        netAmount: '200.0000',
      })
    })

    it('excludes settled invoices, non-recoverable AR, and entries beyond throughDate', async () => {
      const { em, service } = createService()

      const settledInv = invoice({
        id: 'settled-1',
        direction: 'AR',
        settlementStatus: 'SETTLED',
        hasInstallmentPlan: false,
        installments: [],
        dueDate: new Date('2026-03-01T00:00:00.000Z'),
        outstandingAmount: '0.0000',
      })
      const nonRecAr = invoice({
        id: 'non-rec-1',
        direction: 'AR',
        nonRecoverable: true,
        settlementStatus: 'UNSETTLED',
        hasInstallmentPlan: false,
        installments: [],
        dueDate: new Date('2026-03-01T00:00:00.000Z'),
        outstandingAmount: '1000.0000',
      })
      const futureInv = invoice({
        id: 'future-1',
        direction: 'AP',
        settlementStatus: 'UNSETTLED',
        hasInstallmentPlan: false,
        installments: [],
        dueDate: new Date('2027-01-01T00:00:00.000Z'),
        outstandingAmount: '500.0000',
      })
      const validInv = invoice({
        id: 'valid-1',
        direction: 'AP',
        settlementStatus: 'UNSETTLED',
        hasInstallmentPlan: false,
        installments: [],
        dueDate: new Date('2026-06-01T00:00:00.000Z'),
        outstandingAmount: '200.0000',
      })

      jest.mocked(em.find).mockResolvedValue([settledInv, nonRecAr, futureInv, validInv])

      const forecast = await service.getForecast(scope, { throughDate: '2026-10-01' })

      expect(forecast.entries).toHaveLength(1)
      expect(forecast.entries[0].invoiceId).toBe('valid-1')
    })

    it('converts foreign currencies in forecast and fails when FX is unavailable', async () => {
      const mockFx = {
        getRates: jest.fn().mockRejectedValue(new InvoiceExchangeRatesUnavailableError('Provider down')),
      } as unknown as InvoiceExchangeRatesService
      const { em, service } = createService(mockFx)

      const usdInv = invoice({
        id: 'usd-1',
        direction: 'AR',
        currencyCode: 'USD',
        settlementStatus: 'UNSETTLED',
        hasInstallmentPlan: false,
        installments: [],
        dueDate: new Date('2026-04-01T00:00:00.000Z'),
        outstandingAmount: '100.0000',
      })

      jest.mocked(em.find).mockResolvedValue([usdInv])

      await expect(service.getForecast(scope)).rejects.toThrow(InvoiceExchangeRatesUnavailableError)
    })
  })
})
