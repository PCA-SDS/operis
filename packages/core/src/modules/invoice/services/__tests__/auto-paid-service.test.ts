import type { EntityManager } from '@mikro-orm/postgresql'

import { Invoice, InvoiceAutoPaidTaxCode } from '../../data/entities'
import type { InvoiceScope } from '../../data/scope'
import { InvoiceScopedPersistenceService } from '../scoped-persistence-service'
import { InvoiceAutoPaidService } from '../auto-paid-service'

const scope: InvoiceScope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const ruleId = '11111111-1111-4111-8111-111111111111'
const invoiceId = '22222222-2222-4222-8222-222222222222'

function rule(overrides: Partial<InvoiceAutoPaidTaxCode> = {}): InvoiceAutoPaidTaxCode {
  return {
    id: ruleId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    taxCode: '0100109106',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as InvoiceAutoPaidTaxCode
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: invoiceId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    sourceInvoiceId: 'source-1',
    origin: 'GOVERNMENT_PORTAL',
    direction: 'AP',
    sellerTaxCode: '0100109106',
    sellerName: 'Supplier',
    buyerTaxCode: 'buyer-1',
    buyerName: 'Buyer',
    invoiceNumber: 'INV-1',
    invoiceDate: new Date('2026-01-01T00:00:00.000Z'),
    dueDate: new Date('2026-01-31T00:00:00.000Z'),
    currencyCode: 'VND',
    invoiceStatus: 'ACTIVE',
    grossAmount: '120.0000',
    hasReceived: false,
    hasPaid: true,
    settlementStatus: 'SETTLED',
    paidAmount: '120.0000',
    outstandingAmount: '0',
    nextDueDate: null,
    hasInstallmentPlan: false,
    nonRecoverable: false,
    autoSettled: true,
    autoPayExcluded: false,
    searchText: '',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as Invoice
}

function createService() {
  const emMock = {
    findOne: jest.fn(),
    find: jest.fn(),
    upsert: jest.fn(),
    nativeUpdate: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn(),
    transactional: jest.fn(),
  }
  emMock.transactional.mockImplementation((callback: (tx: EntityManager) => unknown) =>
    callback(emMock as unknown as EntityManager),
  )
  const em = emMock as unknown as EntityManager
  const scopedPersistence = new InvoiceScopedPersistenceService(em)
  const service = new InvoiceAutoPaidService(em, scopedPersistence)

  return { em, service }
}

describe('InvoiceAutoPaidService', () => {
  it('lists scoped rules ordered by tax code', async () => {
    const { em, service } = createService()
    jest.mocked(em.find).mockResolvedValue([rule()])

    await expect(service.listRules(scope)).resolves.toHaveLength(1)

    expect(em.find).toHaveBeenCalledWith(InvoiceAutoPaidTaxCode, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, {
      orderBy: { taxCode: 'asc' },
    })
  })

  it('looks up a scoped rule by tax code', async () => {
    const { em, service } = createService()
    const saved = rule()
    jest.mocked(em.findOne).mockResolvedValue(saved)

    await expect(service.findRuleByTaxCode(scope, ' 0100109106 ')).resolves.toBe(saved)

    expect(em.findOne).toHaveBeenCalledWith(InvoiceAutoPaidTaxCode, {
      taxCode: '0100109106',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, undefined)
  })

  it('returns false for empty auto-paid tax code checks without reading', async () => {
    const { em, service } = createService()

    await expect(service.isAutoPaidTaxCode(scope, '  ')).resolves.toBe(false)

    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('upserts the rule and settles matching AP invoices', async () => {
    const { em, service } = createService()
    const saved = rule()
    jest.mocked(em.upsert).mockResolvedValue(saved)
    jest.mocked(em.nativeUpdate).mockResolvedValue(2)

    await expect(service.upsertRule(scope, { taxCode: ' 0100109106 ' })).resolves.toEqual({
      rule: saved,
      settledCount: 2,
    })

    expect(em.upsert).toHaveBeenCalledWith(InvoiceAutoPaidTaxCode, expect.objectContaining({
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      taxCode: '0100109106',
    }), {
      onConflictFields: ['organizationId', 'tenantId', 'taxCode'],
      onConflictMergeFields: ['updatedAt'],
    })
    expect(em.nativeUpdate).toHaveBeenCalledWith(Invoice, expect.objectContaining({
      direction: 'AP',
      sellerTaxCode: '0100109106',
      autoPayExcluded: false,
      deletedAt: null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }), expect.objectContaining({
      settlementStatus: 'SETTLED',
      outstandingAmount: '0',
      hasPaid: true,
      autoSettled: true,
    }))
  })

  it('keeps repeated apply safe by updating only invoices not already settled', async () => {
    const { em, service } = createService()
    jest.mocked(em.nativeUpdate).mockResolvedValue(0)

    await expect(service.settleTaxCode(scope, '0100109106')).resolves.toBe(0)

    expect(jest.mocked(em.nativeUpdate).mock.calls[0]?.[1]).toMatchObject({
      settlementStatus: { $ne: 'SETTLED' },
    })
  })

  it('applies all scoped rules and sums settled counts', async () => {
    const { em, service } = createService()
    jest.mocked(em.find).mockResolvedValue([
      rule({ id: 'rule-1', taxCode: 'TAX-1' }),
      rule({ id: 'rule-2', taxCode: 'TAX-2' }),
    ])
    jest.mocked(em.nativeUpdate).mockResolvedValueOnce(2).mockResolvedValueOnce(3)

    await expect(service.applyAll(scope)).resolves.toEqual({ ruleCount: 2, settledCount: 5 })
  })

  it('removes a scoped rule and reverts only invoices auto-settled by that tax code', async () => {
    const { em, service } = createService()
    jest.mocked(em.findOne).mockResolvedValue(rule({ taxCode: '0100109106' }))
    jest.mocked(em.nativeUpdate).mockResolvedValue(4)

    await expect(service.removeRule(scope, { id: ruleId })).resolves.toEqual({
      ruleId,
      taxCode: '0100109106',
      revertedCount: 4,
    })

    expect(em.remove).toHaveBeenCalledWith(expect.objectContaining({ id: ruleId }))
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.nativeUpdate).toHaveBeenCalledWith(Invoice, expect.objectContaining({
      direction: 'AP',
      sellerTaxCode: '0100109106',
      autoSettled: true,
      deletedAt: null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }), expect.objectContaining({
      settlementStatus: 'UNSETTLED',
      paidAmount: '0',
      hasPaid: false,
      autoSettled: false,
    }))
  })

  it('returns 404 when removing a missing or foreign rule', async () => {
    const { em, service } = createService()
    jest.mocked(em.findOne).mockResolvedValue(null)

    await expect(service.removeRule(scope, { id: ruleId })).rejects.toMatchObject({ status: 404 })

    expect(em.remove).not.toHaveBeenCalled()
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('reverses an AP auto-settled invoice and excludes it from future auto-pay', async () => {
    const { em, service } = createService()
    const existing = invoice()
    jest.mocked(em.findOne).mockResolvedValue(existing)

    await expect(service.reverseInvoice(scope, { invoiceId })).resolves.toEqual({ invoice: existing })

    expect(existing).toMatchObject({
      settlementStatus: 'UNSETTLED',
      paidAmount: '0',
      outstandingAmount: '120.0000',
      nextDueDate: new Date('2026-01-31T00:00:00.000Z'),
      hasPaid: false,
      autoSettled: false,
      autoPayExcluded: true,
    })
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('rejects reverse for AR invoices and invoices already reversed', async () => {
    const { em, service } = createService()
    jest.mocked(em.findOne).mockResolvedValueOnce(invoice({ direction: 'AR' }))

    await expect(service.reverseInvoice(scope, { invoiceId })).rejects.toMatchObject({ status: 400 })

    jest.mocked(em.findOne).mockResolvedValueOnce(invoice({ autoSettled: false }))

    await expect(service.reverseInvoice(scope, { invoiceId })).rejects.toMatchObject({ status: 400 })
  })
})
