import type { EntityManager } from '@mikro-orm/postgresql'

import { Invoice, InvoiceCompany } from '../../data/entities'
import type { InvoiceScope } from '../../data/scope'
import { InvoiceSyncPersistenceService } from '../sync-persistence-service'
import { InvoiceScopedPersistenceService } from '../scoped-persistence-service'
import { normalizeGdtInvoice, type NormalizedInvoiceSource } from '../gdt/invoice-normalizer'

const scope: InvoiceScope = { tenantId: 'tenant-1', organizationId: 'org-1' }

const source = normalizeGdtInvoice('purchased', {
  sellerMst: '0100109106',
  sellerName: 'Seller',
  buyerMst: '0101234567',
  buyerName: 'Buyer',
  templateCode: '01GTKT0',
  series: 'AA/26E',
  number: '123',
  invoiceDate: '2026-09-01',
  grossAmount: '1100',
  netAmount: '1000',
  vatAmount: '100',
  lines: [{ name: 'Item', lineTotal: '1100' }],
})

function createService(sequence: unknown[]) {
  const em = {
    transactional: jest.fn(async (callback: (tx: EntityManager) => Promise<unknown>) => callback(em as unknown as EntityManager)),
    create: jest.fn((_entity: unknown, payload: unknown) => payload),
    flush: jest.fn(),
    nativeDelete: jest.fn(),
  } as unknown as EntityManager
  const scoped = {
    findOne: jest.fn(async () => sequence.shift() ?? null),
    createScoped: jest.fn((_entity: unknown, _scope: InvoiceScope, payload: unknown) => payload),
  } as unknown as InvoiceScopedPersistenceService
  const terms = { resolveDefaultDueDate: jest.fn().mockResolvedValue(new Date('2026-10-01T00:00:00Z')) }
  return { em, scoped, terms, service: new InvoiceSyncPersistenceService(em, scoped, terms as never) }
}

describe('InvoiceSyncPersistenceService', () => {
  it('creates a scoped imported invoice with partner terms and source lines', async () => {
    const { service, terms, scoped } = createService([null, null])
    const result = await service.persist(scope, [source])

    expect(result).toEqual({ created: 1, updated: 0, skipped: 0, failed: 0 })
    expect(terms.resolveDefaultDueDate).toHaveBeenCalledWith(scope, expect.objectContaining({ taxCode: '0100109106' }))
    expect(scoped.createScoped).toHaveBeenCalledWith(InvoiceCompany, scope, expect.objectContaining({ taxCode: '0100109106' }))
  })

  it('updates only source fields and preserves payment metadata and due date', async () => {
    const existing = {
      origin: 'GOVERNMENT_PORTAL',
      dueDate: new Date('2026-09-20T00:00:00Z'),
      dueDateSource: 'explicit',
      settlementStatus: 'PARTIALLY_PAID',
      paidAmount: '300',
      outstandingAmount: '800',
      nextDueDate: new Date('2026-09-20T00:00:00Z'),
      hasInstallmentPlan: true,
      hasPaid: false,
      nonRecoverable: true,
      autoSettled: false,
      lineItems: { removeAll: jest.fn(), add: jest.fn() },
    } as unknown as Invoice
    const company = { name: 'Old Seller', nameSourceDate: new Date('2026-10-01T00:00:00Z'), defaultDueDays: 90 } as unknown as InvoiceCompany
    const { service } = createService([company, existing])
    const changed = { ...source, grossAmount: '1200', sellerName: 'New Seller' } as NormalizedInvoiceSource

    const result = await service.persist(scope, [changed])

    expect(result).toEqual({ created: 0, updated: 1, skipped: 0, failed: 0 })
    expect(existing.grossAmount).toBe('1200')
    expect(existing.dueDateSource).toBe('explicit')
    expect(existing.settlementStatus).toBe('PARTIALLY_PAID')
    expect(existing.paidAmount).toBe('300')
    expect(existing.hasInstallmentPlan).toBe(true)
    expect(company.name).toBe('Old Seller')
    expect(company.defaultDueDays).toBe(90)
  })

  it('skips malformed raw rows and remains repeat-safe', async () => {
    const existing = {
      origin: 'GOVERNMENT_PORTAL',
      lineItems: { removeAll: jest.fn(), add: jest.fn() },
    } as unknown as Invoice
    const company = { name: 'Seller', nameSourceDate: source.invoiceDate, defaultDueDays: 30 } as unknown as InvoiceCompany
    const { service } = createService([null, null, company, existing])
    const malformed = { ...source, grossAmount: 'invalid' } as unknown as Record<string, unknown>

    const skipped = await service.persistRaw(scope, 'sold', [malformed])
    expect(skipped.skipped).toBe(1)

    expect(await service.persist(scope, [source])).toEqual({ created: 1, updated: 0, skipped: 0, failed: 0 })
    expect(await service.persist(scope, [source])).toEqual({ created: 0, updated: 1, skipped: 0, failed: 0 })
  })
})
