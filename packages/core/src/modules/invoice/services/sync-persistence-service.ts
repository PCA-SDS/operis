import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'

import { Invoice, InvoiceCompany, InvoiceLineItem } from '../data/entities'
import type { InvoiceScope } from '../data/scope'
import { INVOICE_PARTNER_DEFAULT_DUE_DAYS } from '../data/validators'
import { createInvoicePartnerTermsService, type InvoicePartnerTermsService } from './partner-terms-service'
import { InvoiceScopedPersistenceService, type InvoiceScopedPersistenceService as InvoiceScopedPersistenceServiceType } from './scoped-persistence-service'
import { MalformedGdtInvoiceError, type NormalizedInvoiceSource } from './gdt/invoice-normalizer'
import { normalizeGdtInvoice } from './gdt/invoice-normalizer'
import type { GdtStream, GdtWireRecord } from './gdt/types'

const logger = createLogger('invoice').child({ component: 'sync-persistence-service' })

export type InvoiceSyncPersistenceResult = {
  created: number
  updated: number
  skipped: number
  failed: number
}

function partnerFor(source: NormalizedInvoiceSource) {
  return source.direction === 'AP'
    ? { taxCode: source.sellerTaxCode, name: source.sellerName }
    : { taxCode: source.buyerTaxCode, name: source.buyerName }
}

function assignSourceFields(invoice: Invoice, source: NormalizedInvoiceSource, company: InvoiceCompany): void {
  invoice.origin = 'GOVERNMENT_PORTAL'
  invoice.direction = source.direction
  invoice.company = company
  invoice.sellerTaxCode = source.sellerTaxCode
  invoice.sellerName = source.sellerName
  invoice.buyerTaxCode = source.buyerTaxCode
  invoice.buyerName = source.buyerName
  invoice.invoiceSymbol = source.invoiceSymbol
  invoice.invoiceNumber = source.invoiceNumber
  invoice.invoiceCode = source.invoiceCode
  invoice.invoiceDate = source.invoiceDate
  invoice.currencyCode = source.currencyCode
  invoice.invoiceStatus = source.invoiceStatus
  invoice.netAmount = source.netAmount
  invoice.vatAmount = source.vatAmount
  invoice.grossAmount = source.grossAmount
}

export class InvoiceSyncPersistenceService {
  constructor(
    private readonly em: EntityManager,
    private readonly scopedPersistence: InvoiceScopedPersistenceService,
    private readonly partnerTermsService: InvoicePartnerTermsService,
  ) {}

  async persist(scope: InvoiceScope, sources: NormalizedInvoiceSource[]): Promise<InvoiceSyncPersistenceResult> {
    const result: InvoiceSyncPersistenceResult = { created: 0, updated: 0, skipped: 0, failed: 0 }
    for (const source of sources) {
      try {
        const created = await this.persistOne(scope, source)
        if (created) result.created += 1
        else result.updated += 1
      } catch (error) {
        if (error instanceof MalformedGdtInvoiceError) {
          result.skipped += 1
          logger.warn('Malformed GDT invoice skipped', { tenantId: scope.tenantId, organizationId: scope.organizationId, sourceInvoiceId: error.sourceIdentity })
        } else {
          result.failed += 1
          logger.error('GDT invoice persistence failed', { tenantId: scope.tenantId, organizationId: scope.organizationId, sourceInvoiceId: source.sourceInvoiceId, err: error })
        }
      }
    }
    return result
  }

  async persistRaw(scope: InvoiceScope, stream: GdtStream, records: GdtWireRecord[]): Promise<InvoiceSyncPersistenceResult> {
    const result: InvoiceSyncPersistenceResult = { created: 0, updated: 0, skipped: 0, failed: 0 }
    for (const record of records) {
      try {
        const source = normalizeGdtInvoice(stream, record)
        const persisted = await this.persist(scope, [source])
        result.created += persisted.created
        result.updated += persisted.updated
        result.skipped += persisted.skipped
        result.failed += persisted.failed
      } catch (error) {
        result.skipped += 1
        logger.warn('Malformed GDT invoice skipped', { tenantId: scope.tenantId, organizationId: scope.organizationId, err: error })
      }
    }
    return result
  }

  private async persistOne(scope: InvoiceScope, source: NormalizedInvoiceSource): Promise<boolean> {
    const work = async (tx: EntityManager) => {
      let wasCreated = false
      const scoped: InvoiceScopedPersistenceServiceType = tx === this.em
        ? this.scopedPersistence
        : new InvoiceScopedPersistenceService(tx)
      const partnerTerms = tx === this.em
        ? this.partnerTermsService
        : createInvoicePartnerTermsService(tx, scoped)
      const partner = partnerFor(source)
      if (!partner.taxCode) throw new MalformedGdtInvoiceError('partner tax code is required', source.sourceInvoiceId)

      let company = await scoped.findOne(InvoiceCompany, scope, { taxCode: partner.taxCode })
      if (!company) {
        company = scoped.createScoped(InvoiceCompany, scope, {
          taxCode: partner.taxCode,
          countryCode: 'VN',
          name: partner.name,
          defaultDueDays: INVOICE_PARTNER_DEFAULT_DUE_DAYS,
          nameSourceDate: source.invoiceDate,
        })
      } else if (!company.nameSourceDate || source.invoiceDate > company.nameSourceDate) {
        company.name = partner.name
        company.nameSourceDate = source.invoiceDate
      }

      const invoice = await scoped.findOne(Invoice, scope, { sourceInvoiceId: source.sourceInvoiceId }, { populate: ['lineItems'] as never[] })
      if (!invoice) {
        wasCreated = true
        const dueDate = await partnerTerms.resolveDefaultDueDate(scope, {
          taxCode: partner.taxCode,
          name: partner.name,
          invoiceDate: source.invoiceDate,
        })
        const createdInvoice = scoped.createScoped(Invoice, scope, {
          sourceInvoiceId: source.sourceInvoiceId,
          dueDate,
          dueDateSource: dueDate ? 'partner_terms' : null,
          hasReceived: false,
          hasPaid: false,
          settlementStatus: 'UNSETTLED',
          paidAmount: '0',
          outstandingAmount: source.grossAmount,
          nextDueDate: dueDate,
          hasInstallmentPlan: false,
          nonRecoverable: false,
          autoSettled: false,
          autoPayExcluded: false,
          company,
        })
        assignSourceFields(createdInvoice, source, company)
        await this.replaceLines(tx, scope, createdInvoice, source.lines)
      } else {
        assignSourceFields(invoice, source, company)
        if (source.lines !== undefined) await this.replaceLines(tx, scope, invoice, source.lines)
      }
      await tx.flush()
      return wasCreated
    }
    if (typeof this.em.transactional === 'function') return Boolean(await this.em.transactional(work))
    return Boolean(await work(this.em))
  }

  private async replaceLines(tx: EntityManager, scope: InvoiceScope, invoice: Invoice, lines: NormalizedInvoiceSource['lines']): Promise<void> {
    if (lines === undefined) return
    await tx.nativeDelete(InvoiceLineItem, { invoice, tenantId: scope.tenantId, organizationId: scope.organizationId })
    invoice.lineItems?.removeAll?.()
    for (const line of lines) {
      const now = new Date()
      const created = tx.create(InvoiceLineItem, {
        ...line,
        invoice,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        createdAt: now,
        updatedAt: now,
      })
      invoice.lineItems?.add?.(created)
    }
  }
}

export function createInvoiceSyncPersistenceService(
  em: EntityManager,
  scopedPersistence: InvoiceScopedPersistenceService,
  partnerTermsService: InvoicePartnerTermsService,
): InvoiceSyncPersistenceService {
  return new InvoiceSyncPersistenceService(em, scopedPersistence, partnerTermsService)
}
