import type { EntityManager } from '@mikro-orm/postgresql'

import { InvoiceService, recomputeInvoiceSettlementRollup } from '../invoice-service'
import { InvoiceScopedPersistenceService } from '../scoped-persistence-service'
import type { Invoice, InvoiceInstallment } from '../../data/entities'
import type { InvoiceScope } from '../../data/scope'

const scope: InvoiceScope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function makeInstallment(overrides: Partial<InvoiceInstallment> = {}): InvoiceInstallment {
  return {
    id: crypto.randomUUID(),
    sequence: 1,
    principalAmount: '60',
    interestRate: '0',
    interestAmount: '0',
    totalAmount: '60',
    dueDate: new Date('2026-02-01T00:00:00.000Z'),
    status: 'PENDING',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as InvoiceInstallment
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    direction: 'AR',
    grossAmount: '120',
    dueDate: new Date('2026-03-01T00:00:00.000Z'),
    settlementStatus: 'UNSETTLED',
    paidAmount: '0',
    outstandingAmount: '120',
    nextDueDate: null,
    hasInstallmentPlan: false,
    hasReceived: false,
    hasPaid: false,
    nonRecoverable: false,
    nonRecoverableNote: null,
    nonRecoverableAt: null,
    lineItems: [],
    installments: [],
    ...overrides,
  } as unknown as Invoice
}

function makeService() {
  const em = {
    findOne: jest.fn(),
    flush: jest.fn(),
  } as unknown as EntityManager
  const service = new InvoiceService(
    em,
    {} as never,
    new InvoiceScopedPersistenceService(em),
  )
  return { em, service }
}

describe('Invoice settlement and non-recoverable operations', () => {
  it('settles and unsets an AR invoice without installments', async () => {
    const { em, service } = makeService()
    const invoice = makeInvoice({ nonRecoverable: true, nonRecoverableNote: 'Customer dispute' })
    jest.mocked(em.findOne).mockResolvedValue(invoice)

    await service.updateReceivableSettlement(scope, invoice.id, { settled: true })
    expect(invoice.settlementStatus).toBe('SETTLED')
    expect(invoice.paidAmount).toBe('120.0000')
    expect(invoice.outstandingAmount).toBe('0.0000')
    expect(invoice.hasReceived).toBe(true)
    expect(invoice.nonRecoverable).toBe(false)
    expect(invoice.nonRecoverableNote).toBeNull()

    await service.updateReceivableSettlement(scope, invoice.id, { settled: false })
    expect(invoice.settlementStatus).toBe('UNSETTLED')
    expect(invoice.paidAmount).toBe('0.0000')
    expect(invoice.outstandingAmount).toBe('120.0000')
  })

  it('settles all installments and recomputes payment rollups', async () => {
    const { em, service } = makeService()
    const invoice = makeInvoice({
      hasInstallmentPlan: true,
      installments: [makeInstallment(), makeInstallment({ sequence: 2, dueDate: new Date('2026-03-01T00:00:00.000Z') })],
    })
    jest.mocked(em.findOne).mockResolvedValue(invoice)

    await service.updateReceivableSettlement(scope, invoice.id, { settled: true })

    expect(invoice.installments.every((item) => item.status === 'PAID')).toBe(true)
    expect(invoice.settlementStatus).toBe('SETTLED')
    expect(invoice.paidAmount).toBe('120.0000')
    expect(invoice.outstandingAmount).toBe('0.0000')
    expect(invoice.nextDueDate).toBeNull()
  })

  it('rejects AP settlement and settled invoice write-off', async () => {
    const { em, service } = makeService()
    const apInvoice = makeInvoice({ direction: 'AP' })
    jest.mocked(em.findOne).mockResolvedValue(apInvoice)
    await expect(service.updateReceivableSettlement(scope, apInvoice.id, { settled: true })).rejects.toMatchObject({ status: 400 })

    const settledInvoice = makeInvoice({ settlementStatus: 'SETTLED' })
    jest.mocked(em.findOne).mockResolvedValue(settledInvoice)
    await expect(service.updateNonRecoverable(scope, settledInvoice.id, { nonRecoverable: true, note: 'Bad debt' }))
      .rejects.toMatchObject({ status: 400 })
  })

  it('requires and preserves the non-recoverable audit note', async () => {
    const { em, service } = makeService()
    const invoice = makeInvoice()
    jest.mocked(em.findOne).mockResolvedValue(invoice)

    await expect(service.updateNonRecoverable(scope, invoice.id, { nonRecoverable: true })).rejects.toThrow()
    await service.updateNonRecoverable(scope, invoice.id, { nonRecoverable: true, note: '  Bad debt  ' })
    expect(invoice.nonRecoverable).toBe(true)
    expect(invoice.nonRecoverableNote).toBe('Bad debt')
    expect(invoice.nonRecoverableAt).toBeInstanceOf(Date)

    await service.updateNonRecoverable(scope, invoice.id, { nonRecoverable: false })
    expect(invoice.nonRecoverable).toBe(false)
    expect(invoice.nonRecoverableNote).toBeNull()
    expect(invoice.nonRecoverableAt).toBeNull()
  })

  it('recomputes partial installment rollups for future payment orchestration', () => {
    const invoice = makeInvoice({
      installments: [
        makeInstallment({ status: 'PAID' }),
        makeInstallment({ sequence: 2, dueDate: new Date('2026-03-01T00:00:00.000Z') }),
      ],
    })

    recomputeInvoiceSettlementRollup(invoice)

    expect(invoice.settlementStatus).toBe('PARTIALLY_PAID')
    expect(invoice.paidAmount).toBe('60.0000')
    expect(invoice.outstandingAmount).toBe('60.0000')
    expect(invoice.nextDueDate).toEqual(new Date('2026-03-01T00:00:00.000Z'))
  })
})
