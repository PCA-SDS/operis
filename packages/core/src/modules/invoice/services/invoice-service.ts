import { randomUUID } from 'node:crypto'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { badRequest, conflict, notFound } from '@open-mercato/shared/lib/crud/errors'
import { E } from '#generated/entities.ids.generated'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'

import { Invoice, InvoiceCompany, InvoiceInstallment, InvoiceLineItem, InvoicePaymentConfirmation } from '../data/entities'
import {
  mapInvoiceEntityToDetailDto,
  mapInvoiceQueryRowToListDto,
  type InvoiceDetailDto,
  type InvoiceListDto,
} from '../data/mappers'
import {
  buildInvoiceListQueryOptions,
  parseInvoiceListQuery,
} from '../data/queries'
import type { InvoiceScope } from '../data/scope'
import {
  INVOICE_MAX_DUE_DAYS,
  INVOICE_PARTNER_DEFAULT_DUE_DAYS,
  invoiceManualCreateSchema,
  invoiceManualUpdateSchema,
  invoiceDueDateUpdateSchema,
  type InvoiceDueDateUpdateInput,
  type InvoiceManualWriteInput,
} from '../data/validators'
import { InvoiceScopedPersistenceService } from './scoped-persistence-service'
import { createInvoiceAutoPaidService } from './auto-paid-service'
import type { InvoicePartnerTermsService } from './partner-terms-service'
import { createInvoicePartnerTermsService } from './partner-terms-service'

export type InvoiceListResult = {
  items: InvoiceListDto[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type InvoiceListInput = Record<string, unknown>
export type InvoiceManualCreateInput = Record<string, unknown>
export type InvoiceManualUpdateInput = Record<string, unknown>
export type InvoiceManualMutationResult = {
  invoice: InvoiceDetailDto
}
export type InvoiceManualDeleteResult = {
  invoiceId: string
  deleted: true
}
export type InvoiceDueDateUpdateResult = InvoiceManualMutationResult

type ManualLineItem = InvoiceManualWriteInput['lineItems'][number]
type PartnerIdentity = {
  company: InvoiceCompany
  sellerName: string
  sellerTaxCode: string
}
type CalculatedLineItem = {
  lineNumber: number
  name: string
  unit: string | null
  quantity: string
  unitPrice: string
  discountAmount: string | null
  discountPercent: string | null
  vatRate: string | null
  vatAmount: string
  lineTotal: string
}
type CalculatedTotals = {
  lineItems: CalculatedLineItem[]
  netAmount: string
  vatAmount: string
  grossAmount: string
}

const MONEY_SCALE = 4
const SYNTHETIC_TAX_CODE_PREFIX = 'auto:'

function money(value: string | number | null | undefined): number {
  if (value == null) return 0
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function moneyString(value: number): string {
  return value.toFixed(MONEY_SCALE)
}

function normalizedSymbol(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function buildInvoiceSearchText(input: {
  invoiceNumber: string
  invoiceSymbol?: string | null
  invoiceCode?: string | null
  buyerName: string
  sellerName: string
  sellerTaxCode?: string | null
}): string {
  return [
    input.invoiceNumber,
    input.invoiceSymbol,
    input.invoiceCode,
    input.buyerName,
    input.sellerName,
    input.sellerTaxCode?.startsWith(SYNTHETIC_TAX_CODE_PREFIX) ? null : input.sellerTaxCode,
  ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join(' ')
}

function buildCompanySearchText(company: { name: string; taxCode: string; countryCode: string }): string {
  return [
    company.name,
    company.taxCode.startsWith(SYNTHETIC_TAX_CODE_PREFIX) ? null : company.taxCode,
    company.countryCode,
  ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join(' ')
}

function calculateTotals(lines: ManualLineItem[]): CalculatedTotals {
  let netAmount = 0
  let vatAmount = 0
  let grossAmount = 0
  const lineItems = lines.map((line, index) => {
    const quantity = money(line.quantity)
    const unitPrice = money(line.unitPrice)
    const baseAmount = quantity * unitPrice
    const discountAmount = line.discountPercent !== undefined
      ? baseAmount * (line.discountPercent / 100)
      : money(line.discountAmount)
    if (discountAmount > baseAmount) throw badRequest('[internal] Invoice line discount exceeds line amount')
    const netLineAmount = baseAmount - discountAmount
    const vatRate = line.vatRate ?? 0
    const vatLineAmount = netLineAmount * (vatRate / 100)
    const lineTotal = netLineAmount + vatLineAmount
    netAmount += netLineAmount
    vatAmount += vatLineAmount
    grossAmount += lineTotal

    return {
      lineNumber: index + 1,
      name: line.name,
      unit: line.unit ?? null,
      quantity: moneyString(quantity),
      unitPrice: moneyString(unitPrice),
      discountAmount: discountAmount > 0 ? moneyString(discountAmount) : null,
      discountPercent: line.discountPercent !== undefined ? moneyString(line.discountPercent) : null,
      vatRate: vatRate > 0 ? moneyString(vatRate) : null,
      vatAmount: moneyString(vatLineAmount),
      lineTotal: moneyString(lineTotal),
    }
  })

  return {
    lineItems,
    netAmount: moneyString(netAmount),
    vatAmount: moneyString(vatAmount),
    grossAmount: moneyString(grossAmount),
  }
}

function invoiceHasInstallmentSchedule(invoice: Invoice): boolean {
  const installments = invoice.installments as unknown
  if (Array.isArray(installments)) return installments.length > 0 || invoice.hasInstallmentPlan
  if (installments && typeof installments === 'object') {
    const collection = installments as {
      getItems?: () => unknown[]
      isInitialized?: () => boolean
    }
    if (typeof collection.getItems === 'function') {
      if (typeof collection.isInitialized === 'function' && !collection.isInitialized()) {
        return invoice.hasInstallmentPlan
      }
      return collection.getItems().length > 0 || invoice.hasInstallmentPlan
    }
  }
  return invoice.hasInstallmentPlan
}

export class InvoiceService {
  constructor(
    private readonly em: EntityManager,
    private readonly queryEngine: QueryEngine,
    private readonly scopedPersistence: InvoiceScopedPersistenceService,
  ) {}

  async listInvoices(scope: InvoiceScope, query: InvoiceListInput = {}): Promise<InvoiceListResult> {
    const parsed = parseInvoiceListQuery(query)
    const options = buildInvoiceListQueryOptions(parsed)
    const result = await this.queryEngine.query<Record<string, unknown>>(E.invoice.invoice, {
      ...options,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })

    return {
      items: result.items.map(mapInvoiceQueryRowToListDto),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: Math.ceil(result.total / parsed.pageSize),
    }
  }

  async getInvoiceDetail(scope: InvoiceScope, id: string): Promise<InvoiceDetailDto> {
    const invoice = await this.scopedPersistence.findById(Invoice, scope, id, {
      populate: ['company', 'lineItems', 'installments'] as never[],
      orderBy: {
        lineItems: { lineNumber: 'asc' },
        installments: { sequence: 'asc' },
      },
    })
    if (!invoice) throw notFound('[internal] Invoice not found')

    return mapInvoiceEntityToDetailDto(invoice)
  }

  async createManualInvoice(scope: InvoiceScope, input: InvoiceManualCreateInput): Promise<InvoiceManualMutationResult> {
    const parsed = invoiceManualCreateSchema.parse(input)

    return this.em.transactional(async (tx) => {
      const txScopedPersistence = new InvoiceScopedPersistenceService(tx)
      const txPartnerTermsService = createInvoicePartnerTermsService(tx, txScopedPersistence)
      const txAutoPaidService = createInvoiceAutoPaidService(tx, txScopedPersistence)
      const organization = await this.loadOrganization(tx, scope)
      const partner = await this.resolvePartner(scope, txScopedPersistence, txPartnerTermsService, parsed)
      const dueDate = await txPartnerTermsService.resolveDefaultDueDate(scope, {
        taxCode: partner.sellerTaxCode,
        name: partner.sellerName,
        invoiceDate: parsed.invoiceDate,
        dueDate: parsed.dueDate ?? null,
      })
      await this.assertNoDuplicate(scope, txScopedPersistence, partner.sellerTaxCode, parsed.invoiceSymbol, parsed.invoiceNumber)

      const totals = calculateTotals(parsed.lineItems)
      const autoSettled = await txAutoPaidService.isAutoPaidTaxCode(scope, partner.sellerTaxCode)
      const invoice = txScopedPersistence.createScoped(Invoice, scope, {
        sourceInvoiceId: `manual:${randomUUID()}`,
        origin: 'MANUAL',
        direction: 'AP',
        company: partner.company,
        sellerTaxCode: partner.sellerTaxCode,
        sellerName: partner.sellerName,
        buyerTaxCode: null,
        buyerName: organization.name,
        invoiceSymbol: normalizedSymbol(parsed.invoiceSymbol),
        invoiceNumber: parsed.invoiceNumber,
        invoiceCode: normalizedSymbol(parsed.invoiceCode),
        invoiceDate: parsed.invoiceDate,
        dueDate,
        dueDateSource: parsed.dueDate ? 'explicit' : dueDate ? 'partner_terms' : null,
        currencyCode: parsed.currencyCode,
        invoiceStatus: 'ACTIVE',
        netAmount: totals.netAmount,
        vatAmount: totals.vatAmount,
        grossAmount: totals.grossAmount,
        hasReceived: false,
        hasPaid: autoSettled,
        settlementStatus: autoSettled ? 'SETTLED' : 'UNSETTLED',
        paidAmount: autoSettled ? totals.grossAmount : '0',
        outstandingAmount: autoSettled ? '0' : totals.grossAmount,
        nextDueDate: autoSettled ? null : dueDate,
        hasInstallmentPlan: false,
        nonRecoverable: false,
        nonRecoverableNote: null,
        nonRecoverableAt: null,
        lastSentAt: null,
        emailTrackingTokenHash: null,
        openedAt: null,
        autoSettled,
        autoPayExcluded: false,
        searchText: buildInvoiceSearchText({
          invoiceNumber: parsed.invoiceNumber,
          invoiceSymbol: parsed.invoiceSymbol,
          invoiceCode: parsed.invoiceCode,
          buyerName: organization.name,
          sellerName: partner.sellerName,
          sellerTaxCode: partner.sellerTaxCode,
        }),
      })
      this.replaceLineItems(tx, scope, invoice, totals.lineItems)
      await tx.flush()

      return { invoice: mapInvoiceEntityToDetailDto(invoice) }
    })
  }

  async updateManualInvoice(
    scope: InvoiceScope,
    id: string,
    input: InvoiceManualUpdateInput,
  ): Promise<InvoiceManualMutationResult> {
    const parsed = invoiceManualUpdateSchema.parse(input)

    return this.em.transactional(async (tx) => {
      const txScopedPersistence = new InvoiceScopedPersistenceService(tx)
      const txPartnerTermsService = createInvoicePartnerTermsService(tx, txScopedPersistence)
      const txAutoPaidService = createInvoiceAutoPaidService(tx, txScopedPersistence)
      const invoice = await txScopedPersistence.findById(Invoice, scope, id, {
        populate: ['lineItems', 'installments', 'paymentConfirmations'] as never[],
      })
      if (!invoice) throw notFound('[internal] Invoice not found')
      this.assertManualInvoice(invoice)

      const organization = await this.loadOrganization(tx, scope)
      const partner = await this.resolvePartner(scope, txScopedPersistence, txPartnerTermsService, parsed)
      const dueDate = await txPartnerTermsService.resolveDefaultDueDate(scope, {
        taxCode: partner.sellerTaxCode,
        name: partner.sellerName,
        invoiceDate: parsed.invoiceDate,
        dueDate: parsed.dueDate ?? null,
      })
      await this.assertNoDuplicate(scope, txScopedPersistence, partner.sellerTaxCode, parsed.invoiceSymbol, parsed.invoiceNumber, id)

      const totals = calculateTotals(parsed.lineItems)
      const autoSettled = await txAutoPaidService.isAutoPaidTaxCode(scope, partner.sellerTaxCode)
      invoice.company = partner.company
      invoice.sellerTaxCode = partner.sellerTaxCode
      invoice.sellerName = partner.sellerName
      invoice.buyerTaxCode = null
      invoice.buyerName = organization.name
      invoice.invoiceSymbol = normalizedSymbol(parsed.invoiceSymbol)
      invoice.invoiceNumber = parsed.invoiceNumber
      invoice.invoiceCode = normalizedSymbol(parsed.invoiceCode)
      invoice.invoiceDate = parsed.invoiceDate
      invoice.dueDate = dueDate
      invoice.dueDateSource = parsed.dueDate ? 'explicit' : dueDate ? 'partner_terms' : null
      invoice.currencyCode = parsed.currencyCode
      invoice.invoiceStatus = 'ACTIVE'
      invoice.netAmount = totals.netAmount
      invoice.vatAmount = totals.vatAmount
      invoice.grossAmount = totals.grossAmount
      invoice.hasReceived = false
      invoice.hasPaid = autoSettled
      invoice.settlementStatus = autoSettled ? 'SETTLED' : 'UNSETTLED'
      invoice.paidAmount = autoSettled ? totals.grossAmount : '0'
      invoice.outstandingAmount = autoSettled ? '0' : totals.grossAmount
      invoice.nextDueDate = autoSettled ? null : dueDate
      invoice.hasInstallmentPlan = false
      invoice.nonRecoverable = false
      invoice.nonRecoverableNote = null
      invoice.nonRecoverableAt = null
      invoice.lastSentAt = null
      invoice.emailTrackingTokenHash = null
      invoice.openedAt = null
      invoice.autoSettled = autoSettled
      invoice.autoPayExcluded = false
      invoice.searchText = buildInvoiceSearchText({
        invoiceNumber: parsed.invoiceNumber,
        invoiceSymbol: parsed.invoiceSymbol,
        invoiceCode: parsed.invoiceCode,
        buyerName: organization.name,
        sellerName: partner.sellerName,
        sellerTaxCode: partner.sellerTaxCode,
      })
      await tx.nativeDelete(InvoiceLineItem, { invoice })
      await tx.nativeDelete(InvoiceInstallment, { invoice })
      await tx.nativeDelete(InvoicePaymentConfirmation, { invoice })
      invoice.lineItems?.removeAll?.()
      invoice.installments?.removeAll?.()
      invoice.paymentConfirmations?.removeAll?.()
      this.replaceLineItems(tx, scope, invoice, totals.lineItems)
      await tx.flush()

      return { invoice: mapInvoiceEntityToDetailDto(invoice) }
    })
  }

  async updateDueDate(
    scope: InvoiceScope,
    id: string,
    rawInput: InvoiceDueDateUpdateInput,
  ): Promise<InvoiceDueDateUpdateResult> {
    const input = invoiceDueDateUpdateSchema.parse(rawInput)
    const invoice = await this.scopedPersistence.findById(Invoice, scope, id, {
      populate: ['lineItems', 'installments'] as never[],
      orderBy: {
        lineItems: { lineNumber: 'asc' },
        installments: { sequence: 'asc' },
      },
    })
    if (!invoice) throw notFound('[internal] Invoice not found')

    if (input.dueDate != null) {
      const invoiceDate = invoice.invoiceDate instanceof Date
        ? invoice.invoiceDate
        : new Date(invoice.invoiceDate)

      if (input.dueDate < invoiceDate) {
        throw badRequest('[internal] Due date cannot be before invoice date')
      }

      const maxDate = new Date(invoiceDate)
      maxDate.setDate(maxDate.getDate() + INVOICE_MAX_DUE_DAYS)
      if (input.dueDate > maxDate) {
        throw badRequest(`[internal] Due date cannot be more than ${INVOICE_MAX_DUE_DAYS} days after invoice date`)
      }
    }

    invoice.dueDate = input.dueDate ?? null
    invoice.dueDateSource = input.dueDate != null ? 'explicit' : null

    // nextDueDate scheduling rule:
    //   - installment plan is authoritative → leave nextDueDate alone
    //   - settled invoice → nextDueDate is always null
    //   - otherwise → mirror the new dueDate
    if (!invoiceHasInstallmentSchedule(invoice)) {
      invoice.nextDueDate = invoice.settlementStatus === 'SETTLED' ? null : (input.dueDate ?? null)
    }

    await this.em.flush()

    return { invoice: mapInvoiceEntityToDetailDto(invoice) }
  }

  async deleteManualInvoice(scope: InvoiceScope, id: string): Promise<InvoiceManualDeleteResult> {
    const invoice = await this.scopedPersistence.findById(Invoice, scope, id)
    if (!invoice) throw notFound('[internal] Invoice not found')
    this.assertManualInvoice(invoice)
    invoice.deletedAt = new Date()
    await this.em.flush()

    return { invoiceId: id, deleted: true }
  }

  private async loadOrganization(tx: EntityManager, scope: InvoiceScope): Promise<Organization> {
    const organization = await tx.findOne(Organization, {
      id: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<Organization>)
    if (!organization) throw badRequest('[internal] Invoice organization scope is invalid')
    return organization
  }

  private async resolvePartner(
    scope: InvoiceScope,
    scopedPersistence: InvoiceScopedPersistenceService,
    partnerTermsService: InvoicePartnerTermsService,
    input: InvoiceManualWriteInput,
  ): Promise<PartnerIdentity> {
    const matched = await partnerTermsService.matchPartner(scope, {
      taxCode: input.partnerTaxCode,
      name: input.partnerName,
    })
    if (matched) {
      return {
        company: matched,
        sellerName: input.partnerName,
        sellerTaxCode: input.partnerTaxCode ?? matched.taxCode,
      }
    }

    const sellerTaxCode = input.partnerTaxCode ?? `${SYNTHETIC_TAX_CODE_PREFIX}${randomUUID()}`
    const company = scopedPersistence.createScoped(InvoiceCompany, scope, {
      taxCode: sellerTaxCode,
      countryCode: input.partnerCountryCode,
      name: input.partnerName,
      defaultDueDays: INVOICE_PARTNER_DEFAULT_DUE_DAYS,
      searchText: buildCompanySearchText({
        name: input.partnerName,
        taxCode: sellerTaxCode,
        countryCode: input.partnerCountryCode,
      }),
    })

    return {
      company,
      sellerName: input.partnerName,
      sellerTaxCode,
    }
  }

  private async assertNoDuplicate(
    scope: InvoiceScope,
    scopedPersistence: InvoiceScopedPersistenceService,
    sellerTaxCode: string,
    invoiceSymbol: string | null | undefined,
    invoiceNumber: string,
    excludeInvoiceId?: string,
  ): Promise<void> {
    const where: FilterQuery<Invoice> = {
      direction: 'AP',
      sellerTaxCode,
      invoiceSymbol: normalizedSymbol(invoiceSymbol),
      invoiceNumber,
    }
    if (excludeInvoiceId) {
      ;(where as Record<string, unknown>).id = { $ne: excludeInvoiceId }
    }
    const duplicate = await scopedPersistence.findOne(Invoice, scope, where)
    if (duplicate) throw conflict('[internal] Duplicate manual invoice')
  }

  private replaceLineItems(
    em: EntityManager,
    scope: InvoiceScope,
    invoice: Invoice,
    lineItems: CalculatedLineItem[],
  ): void {
    for (const lineItem of lineItems) {
      const created = em.create(InvoiceLineItem, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        invoice,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...lineItem,
      })
      invoice.lineItems?.add?.(created)
    }
  }

  private assertManualInvoice(invoice: Invoice): void {
    if (invoice.origin !== 'MANUAL') throw badRequest('[internal] Imported invoice cannot be changed')
    if (invoice.direction !== 'AP') throw badRequest('[internal] Only manual AP invoices can be changed')
  }
}

export function createInvoiceService(
  em: EntityManager,
  queryEngine: QueryEngine,
  scopedPersistence: InvoiceScopedPersistenceService,
): InvoiceService {
  return new InvoiceService(em, queryEngine, scopedPersistence)
}
