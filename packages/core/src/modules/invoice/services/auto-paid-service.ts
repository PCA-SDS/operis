import { raw } from '@mikro-orm/core'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { badRequest, notFound } from '@open-mercato/shared/lib/crud/errors'

import { Invoice, InvoiceAutoPaidTaxCode } from '../data/entities'
import type { InvoiceScope } from '../data/scope'
import {
  invoiceAutoPaidReverseSchema,
  invoiceAutoPaidRuleRemoveSchema,
  invoiceAutoPaidRuleUpsertSchema,
  invoiceTaxCodeSchema,
} from '../data/validators'
import { InvoiceScopedPersistenceService } from './scoped-persistence-service'

export type InvoiceAutoPaidRuleInput = {
  taxCode: string
}

export type InvoiceAutoPaidRemoveInput = {
  id: string
}

export type InvoiceAutoPaidReverseInput = {
  invoiceId: string
}

export type InvoiceAutoPaidRuleResult = {
  rule: InvoiceAutoPaidTaxCode
  settledCount: number
}

export type InvoiceAutoPaidRemoveResult = {
  ruleId: string
  taxCode: string
  revertedCount: number
}

export type InvoiceAutoPaidApplyAllResult = {
  settledCount: number
  ruleCount: number
}

export type InvoiceAutoPaidReverseResult = {
  invoice: Invoice
}

export class InvoiceAutoPaidService {
  constructor(
    private readonly em: EntityManager,
    private readonly scopedPersistence: InvoiceScopedPersistenceService,
  ) {}

  listRules(scope: InvoiceScope): Promise<InvoiceAutoPaidTaxCode[]> {
    return this.scopedPersistence.findMany(InvoiceAutoPaidTaxCode, scope, {}, {
      orderBy: { taxCode: 'asc' },
    })
  }

  findRuleByTaxCode(scope: InvoiceScope, taxCode: string): Promise<InvoiceAutoPaidTaxCode | null> {
    const parsedTaxCode = invoiceTaxCodeSchema.parse(taxCode)
    return this.scopedPersistence.findOne(InvoiceAutoPaidTaxCode, scope, { taxCode: parsedTaxCode })
  }

  async isAutoPaidTaxCode(scope: InvoiceScope, taxCode: string | null | undefined): Promise<boolean> {
    const trimmed = taxCode?.trim()
    if (!trimmed) return false
    return (await this.findRuleByTaxCode(scope, trimmed)) !== null
  }

  async upsertRule(scope: InvoiceScope, input: InvoiceAutoPaidRuleInput): Promise<InvoiceAutoPaidRuleResult> {
    const parsed = invoiceAutoPaidRuleUpsertSchema.parse(input)
    const now = new Date()
    const rule = await this.em.upsert(InvoiceAutoPaidTaxCode, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      taxCode: parsed.taxCode,
      createdAt: now,
      updatedAt: now,
    }, {
      onConflictFields: ['organizationId', 'tenantId', 'taxCode'],
      onConflictMergeFields: ['updatedAt'],
    })
    const settledCount = await this.settleTaxCode(scope, parsed.taxCode, now)

    return { rule, settledCount }
  }

  async removeRule(scope: InvoiceScope, input: InvoiceAutoPaidRemoveInput): Promise<InvoiceAutoPaidRemoveResult> {
    const parsed = invoiceAutoPaidRuleRemoveSchema.parse(input)

    return this.em.transactional(async (tx) => {
      const scopedPersistence = new InvoiceScopedPersistenceService(tx)
      const rule = await scopedPersistence.findById(InvoiceAutoPaidTaxCode, scope, parsed.id)
      if (!rule) throw notFound('[internal] Invoice auto-paid rule not found')

      const taxCode = rule.taxCode
      const txService = new InvoiceAutoPaidService(tx, scopedPersistence)
      const revertedCount = await txService.revertTaxCode(scope, taxCode)
      tx.remove(rule)
      await tx.flush()

      return { ruleId: parsed.id, taxCode, revertedCount }
    })
  }

  async applyAll(scope: InvoiceScope): Promise<InvoiceAutoPaidApplyAllResult> {
    const rules = await this.listRules(scope)
    let settledCount = 0

    for (const rule of rules) {
      settledCount += await this.settleTaxCode(scope, rule.taxCode)
    }

    return { settledCount, ruleCount: rules.length }
  }

  async reverseInvoice(scope: InvoiceScope, input: InvoiceAutoPaidReverseInput): Promise<InvoiceAutoPaidReverseResult> {
    const parsed = invoiceAutoPaidReverseSchema.parse(input)
    const invoice = await this.scopedPersistence.findById(Invoice, scope, parsed.invoiceId)
    if (!invoice) throw notFound('[internal] Invoice not found')
    if (invoice.direction !== 'AP') throw badRequest('[internal] Only AP invoices can reverse auto-paid settlement')
    if (!invoice.autoSettled) throw badRequest('[internal] Invoice is not auto-settled')

    invoice.settlementStatus = 'UNSETTLED'
    invoice.paidAmount = '0'
    invoice.outstandingAmount = invoice.grossAmount
    invoice.nextDueDate = invoice.dueDate ?? null
    invoice.hasPaid = false
    invoice.autoSettled = false
    invoice.autoPayExcluded = true
    await this.em.flush()

    return { invoice }
  }

  async settleTaxCode(scope: InvoiceScope, taxCode: string, now = new Date()): Promise<number> {
    const parsedTaxCode = invoiceTaxCodeSchema.parse(taxCode)

    return this.em.nativeUpdate(Invoice, this.buildInvoiceWhere(scope, {
      direction: 'AP',
      sellerTaxCode: parsedTaxCode,
      autoPayExcluded: false,
      deletedAt: null,
      settlementStatus: { $ne: 'SETTLED' },
    }), {
      settlementStatus: 'SETTLED',
      paidAmount: raw('gross_amount'),
      outstandingAmount: '0',
      nextDueDate: null,
      hasPaid: true,
      autoSettled: true,
      updatedAt: now,
    })
  }

  async revertTaxCode(scope: InvoiceScope, taxCode: string, now = new Date()): Promise<number> {
    const parsedTaxCode = invoiceTaxCodeSchema.parse(taxCode)

    return this.em.nativeUpdate(Invoice, this.buildInvoiceWhere(scope, {
      direction: 'AP',
      sellerTaxCode: parsedTaxCode,
      autoSettled: true,
      deletedAt: null,
    }), {
      settlementStatus: 'UNSETTLED',
      paidAmount: '0',
      outstandingAmount: raw('gross_amount'),
      nextDueDate: raw('due_date'),
      hasPaid: false,
      autoSettled: false,
      updatedAt: now,
    })
  }

  private buildInvoiceWhere(scope: InvoiceScope, where: FilterQuery<Invoice>): FilterQuery<Invoice> {
    return {
      ...where,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  }
}

export function createInvoiceAutoPaidService(
  em: EntityManager,
  scopedPersistence: InvoiceScopedPersistenceService,
): InvoiceAutoPaidService {
  return new InvoiceAutoPaidService(em, scopedPersistence)
}
