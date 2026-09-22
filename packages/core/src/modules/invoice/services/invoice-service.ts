import { randomUUID } from 'node:crypto'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { detectLocale, resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'

import { invoiceBadRequest, invoiceConflict, invoiceNotFound } from '../data/errors'
import { Invoice, InvoiceCompany, InvoiceInstallment, InvoiceLineItem, InvoicePaymentConfirmation } from '../data/entities'
import {
  mapInvoiceEntityToDetailDto,
  mapInvoiceQueryRowToListDto,
  type InvoiceDetailDto,
  type InvoiceForecastDto,
  type InvoiceForecastBucketDto,
  type InvoiceForecastEntryDto,
  type InvoiceForecastSeriesDto,
  type InvoiceForecastSeriesPointDto,
  type InvoiceListDto,
  type InvoiceSummaryDto,
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
  invoiceSettlementUpdateSchema,
  invoiceInstallmentPlanUpdateSchema,
  invoiceInstallmentStatusUpdateSchema,
  invoiceNonRecoverableUpdateSchema,
  invoiceForecastQuerySchema,
  invoiceSummaryQuerySchema,
  invoiceSendSchema,
  type InvoiceDueDateUpdateInput,
  type InvoiceForecastQueryInput,
  type InvoiceSummaryQueryInput,
  type InvoiceNonRecoverableUpdateInput,
  type InvoiceSettlementUpdateInput,
  type InvoiceInstallmentPlanUpdateInput,
  type InvoiceInstallmentStatusUpdateInput,
  type InvoiceManualWriteInput,
  type InvoiceSendInput,
} from '../data/validators'
import { emitInvoiceEvent } from '../events'
import { createInvoiceEmail, generateInvoiceTrackingToken } from './invoice-email'
import type { InvoiceCompanyEmailsService } from './company-emails-service'
import { InvoiceScopedPersistenceService } from './scoped-persistence-service'
import { createInvoiceAutoPaidService } from './auto-paid-service'
import type { InvoicePartnerTermsService } from './partner-terms-service'
import { createInvoicePartnerTermsService } from './partner-terms-service'
import {
  createInvoiceExchangeRatesService,
  InvoiceExchangeRatesService,
  InvoiceExchangeRatesUnavailableError,
  type InvoiceExchangeRatesDto,
} from './exchange-rates-service'

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
export type InvoiceSettlementUpdateResult = InvoiceManualMutationResult
export type InvoiceInstallmentPlanUpdateResult = InvoiceManualMutationResult
export type InvoiceInstallmentStatusUpdateResult = InvoiceManualMutationResult
export type InvoiceNonRecoverableUpdateResult = InvoiceManualMutationResult
export type InvoicePaymentApplicationInput = {
  installmentId?: string
}

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
const logger = createLogger('invoice').child({ component: 'invoice-service' })

function money(value: string | number | null | undefined): number {
  if (value == null) return 0
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function moneyString(value: number): string {
  return value.toFixed(MONEY_SCALE)
}

/**
 * Snap to the 4 decimals the `numeric(18,4)` columns actually hold.
 *
 * Totals must be accumulated from these rounded values, not from the raw
 * products: rounding each line for storage while summing the unrounded ones for
 * the header left the invoice disagreeing with its own line rows.
 */
function roundMoney(value: number): number {
  return Number(value.toFixed(MONEY_SCALE))
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
    const quantity = roundMoney(money(line.quantity))
    const unitPrice = roundMoney(money(line.unitPrice))
    const baseAmount = roundMoney(quantity * unitPrice)
    const discountAmount = roundMoney(line.discountPercent !== undefined
      ? baseAmount * (line.discountPercent / 100)
      : money(line.discountAmount))
    if (discountAmount > baseAmount) throw invoiceBadRequest('invoice.errors.line_discount_exceeds_amount', 'Invoice line discount exceeds line amount')
    const netLineAmount = roundMoney(baseAmount - discountAmount)
    const vatRate = line.vatRate ?? 0
    const vatLineAmount = roundMoney(netLineAmount * (vatRate / 100))
    const lineTotal = roundMoney(netLineAmount + vatLineAmount)
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
    netAmount: moneyString(roundMoney(netAmount)),
    vatAmount: moneyString(roundMoney(vatAmount)),
    grossAmount: moneyString(roundMoney(grossAmount)),
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

function invoiceInstallmentItems(invoice: Invoice): InvoiceInstallment[] {
  const installments = invoice.installments as unknown
  if (Array.isArray(installments)) return installments
  if (installments && typeof installments === 'object') {
    const collection = installments as {
      getItems?: () => unknown[]
      isInitialized?: () => boolean
    }
    if (typeof collection.getItems === 'function') {
      if (typeof collection.isInitialized === 'function' && !collection.isInitialized()) return []
      return collection.getItems() as InvoiceInstallment[]
    }
  }
  return []
}

export function recomputeInvoiceSettlementRollup(invoice: Invoice): void {
  const installments = invoiceInstallmentItems(invoice)
  invoice.hasInstallmentPlan = installments.length > 0

  if (installments.length === 0) {
    if (invoice.settlementStatus === 'SETTLED') {
      invoice.paidAmount = moneyString(money(invoice.grossAmount))
      invoice.outstandingAmount = moneyString(0)
      invoice.nextDueDate = null
    } else {
      invoice.settlementStatus = 'UNSETTLED'
      invoice.paidAmount = moneyString(0)
      invoice.outstandingAmount = moneyString(money(invoice.grossAmount))
      invoice.nextDueDate = invoice.dueDate ?? null
    }
  } else {
    const paidAmount = installments
      .filter((installment) => installment.status === 'PAID')
      .reduce((total, installment) => total + money(installment.totalAmount), 0)
    const outstandingAmount = installments
      .filter((installment) => installment.status !== 'PAID')
      .reduce((total, installment) => total + money(installment.totalAmount), 0)
    const nextPending = installments
      .filter((installment) => installment.status !== 'PAID')
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0]

    invoice.paidAmount = moneyString(paidAmount)
    invoice.outstandingAmount = moneyString(outstandingAmount)
    invoice.nextDueDate = nextPending?.dueDate ?? null
    if (outstandingAmount <= 0) {
      invoice.settlementStatus = 'SETTLED'
    } else if (paidAmount > 0) {
      invoice.settlementStatus = 'PARTIALLY_PAID'
    } else {
      invoice.settlementStatus = 'UNSETTLED'
    }
  }

  invoice.hasReceived = invoice.direction === 'AR' && invoice.settlementStatus === 'SETTLED'
  invoice.hasPaid = invoice.direction === 'AP' && invoice.settlementStatus === 'SETTLED'
}

export class InvoiceService {
  constructor(
    private readonly em: EntityManager,
    private readonly queryEngine: QueryEngine,
    private readonly scopedPersistence: InvoiceScopedPersistenceService,
    private readonly exchangeRatesService: InvoiceExchangeRatesService = createInvoiceExchangeRatesService(),
    private readonly companyEmailsService?: InvoiceCompanyEmailsService,
  ) {}

  forTransaction(em: EntityManager): InvoiceService {
    return new InvoiceService(
      em,
      this.queryEngine,
      new InvoiceScopedPersistenceService(em),
      this.exchangeRatesService,
      this.companyEmailsService,
    )
  }

  async getSummary(scope: InvoiceScope, rawInput: InvoiceSummaryQueryInput = {}): Promise<InvoiceSummaryDto> {
    const input = invoiceSummaryQuerySchema.parse(rawInput)
    const invoices = await this.scopedPersistence.findMany(Invoice, scope, {
      invoiceStatus: 'ACTIVE',
    })

    const scopedInvoices = input.throughDate
      ? invoices.filter((inv) => inv.dueDate && inv.dueDate.toISOString().slice(0, 10) <= input.throughDate!)
      : invoices
    const hasForeignCurrency = scopedInvoices.some((inv) => inv.currencyCode !== 'VND')
    let ratesDto: InvoiceExchangeRatesDto | null = null
    if (hasForeignCurrency) {
      ratesDto = await this.exchangeRatesService.getRates()
    }

    const resolveVndRate = (currencyCode: string): number => {
      if (currencyCode === 'VND') return 1
      const rateItem = ratesDto?.rates[currencyCode as keyof typeof ratesDto.rates]
      if (!rateItem || typeof rateItem.vndPerUnit !== 'number' || rateItem.vndPerUnit <= 0) {
        throw new InvoiceExchangeRatesUnavailableError(
          `[internal] exchange rate for ${currencyCode} is unavailable`,
        )
      }
      return rateItem.vndPerUnit
    }

    let arOutstanding = 0
    let arSettled = 0
    let arNonRecoverable = 0
    let apOutstanding = 0
    let apSettled = 0
    const counts = {
      AR: { unpaidInvoices: 0, partiallyPaidInvoices: 0, paidInvoices: 0, unreceivedInvoices: 0, receivedInvoices: 0, nonRecoverableInvoices: 0 },
      AP: { unpaidInvoices: 0, partiallyPaidInvoices: 0, paidInvoices: 0, unreceivedInvoices: 0, receivedInvoices: 0, nonRecoverableInvoices: 0 },
    }

    for (const inv of scopedInvoices) {
      const rate = resolveVndRate(inv.currencyCode)
      const paidVnd = money(inv.paidAmount) * rate
      const outstandingVnd = money(inv.outstandingAmount) * rate
      if (inv.settlementStatus === 'SETTLED') counts[inv.direction].paidInvoices += 1
      else if (inv.settlementStatus === 'PARTIALLY_PAID') counts[inv.direction].partiallyPaidInvoices += 1
      else counts[inv.direction].unpaidInvoices += 1
      if (inv.hasReceived) counts[inv.direction].receivedInvoices += 1
      else counts[inv.direction].unreceivedInvoices += 1
      if (inv.nonRecoverable) counts[inv.direction].nonRecoverableInvoices += 1

      if (inv.direction === 'AR') {
        arSettled += paidVnd
        if (inv.nonRecoverable) {
          arNonRecoverable += outstandingVnd
        } else {
          arOutstanding += outstandingVnd
        }
      } else if (inv.direction === 'AP') {
        apSettled += paidVnd
        apOutstanding += outstandingVnd
      }
    }

    const netPosition = arOutstanding - apOutstanding

    return {
      currency: 'VND',
      ar: {
        outstanding: moneyString(arOutstanding),
        settled: moneyString(arSettled),
        net: moneyString(arOutstanding),
        total: moneyString(arOutstanding + arSettled),
        outstandingAmount: moneyString(arOutstanding),
        settledAmount: moneyString(arSettled),
        totalAmount: moneyString(arOutstanding + arSettled),
        nonRecoverableAmount: moneyString(arNonRecoverable),
        ...counts.AR,
      },
      ap: {
        outstanding: moneyString(apOutstanding),
        settled: moneyString(apSettled),
        net: moneyString(apOutstanding),
        total: moneyString(apOutstanding + apSettled),
        outstandingAmount: moneyString(apOutstanding),
        settledAmount: moneyString(apSettled),
        totalAmount: moneyString(apOutstanding + apSettled),
        ...counts.AP,
      },
      netPosition: moneyString(netPosition),
      net: moneyString(netPosition),
      netOutstanding: moneyString(netPosition),
      ratesStale: ratesDto?.stale ?? false,
    }
  }

  async getForecast(scope: InvoiceScope, rawInput: InvoiceForecastQueryInput = {}): Promise<InvoiceForecastDto> {
    const input = invoiceForecastQuerySchema.parse(rawInput)
    let effectiveThroughDateString: string
    if (input.throughDate) {
      const parsedDate = new Date(input.throughDate)
      if (Number.isNaN(parsedDate.getTime())) {
        throw invoiceBadRequest('invoice.errors.invalid_through_date', 'Invalid throughDate')
      }
      effectiveThroughDateString = parsedDate.toISOString().slice(0, 10)
    } else {
      const defaultDate = new Date()
      defaultDate.setFullYear(defaultDate.getFullYear() + 1)
      effectiveThroughDateString = defaultDate.toISOString().slice(0, 10)
    }

    const invoices = await this.scopedPersistence.findMany(Invoice, scope, {
      invoiceStatus: 'ACTIVE',
      settlementStatus: { $ne: 'SETTLED' },
    }, {
      populate: ['installments'] as never[],
      orderBy: { dueDate: 'asc' },
    })

    const eligibleInvoices = invoices.filter((inv) => {
      if (inv.direction === 'AR' && inv.nonRecoverable) return false
      if (inv.settlementStatus === 'SETTLED') return false
      return true
    })

    const hasForeignCurrency = eligibleInvoices.some((inv) => inv.currencyCode !== 'VND')
    let ratesDto: InvoiceExchangeRatesDto | null = null
    if (hasForeignCurrency) {
      ratesDto = await this.exchangeRatesService.getRates()
    }

    const resolveVndRate = (currencyCode: string): number => {
      if (currencyCode === 'VND') return 1
      const rateItem = ratesDto?.rates[currencyCode as keyof typeof ratesDto.rates]
      if (!rateItem || typeof rateItem.vndPerUnit !== 'number' || rateItem.vndPerUnit <= 0) {
        throw new InvoiceExchangeRatesUnavailableError(
          `[internal] exchange rate for ${currencyCode} is unavailable`,
        )
      }
      return rateItem.vndPerUnit
    }

    const entries: InvoiceForecastEntryDto[] = []
    const todayString = new Date().toISOString().slice(0, 10)
    const horizonStart = new Date(`${todayString}T00:00:00.000Z`)
    const horizonEnd = new Date(`${effectiveThroughDateString}T00:00:00.000Z`)
    const horizonDays = Math.max(0, Math.round((horizonEnd.getTime() - horizonStart.getTime()) / 86_400_000))
    type ForecastBucket = { amount: number; count: number }
    type ForecastAggregation = {
      byDate: Map<string, ForecastBucket>
      overdue: ForecastBucket
      undated: ForecastBucket
      beyondHorizon: ForecastBucket
      totalAmount: number
    }
    const emptyBucket = (): ForecastBucket => ({ amount: 0, count: 0 })
    const createAggregation = (): ForecastAggregation => ({
      byDate: new Map(),
      overdue: emptyBucket(),
      undated: emptyBucket(),
      beyondHorizon: emptyBucket(),
      totalAmount: 0,
    })
    const receivable = createAggregation()
    const payable = createAggregation()

    const recordForecast = (aggregation: ForecastAggregation, date: Date, amount: number, entry: InvoiceForecastEntryDto) => {
      const dateString = date.toISOString().slice(0, 10)
      entries.push(entry)
      if (dateString <= effectiveThroughDateString) aggregation.totalAmount += amount
      if (dateString < todayString) {
        aggregation.overdue.amount += amount
        aggregation.overdue.count += 1
        return
      }
      if (dateString > effectiveThroughDateString) {
        aggregation.beyondHorizon.amount += amount
        aggregation.beyondHorizon.count += 1
        return
      }
      const current = aggregation.byDate.get(dateString) ?? emptyBucket()
      current.amount += amount
      current.count += 1
      aggregation.byDate.set(dateString, current)
    }

    for (const inv of eligibleInvoices) {
      const rate = resolveVndRate(inv.currencyCode)

      if (inv.hasInstallmentPlan && invoiceInstallmentItems(inv).length > 0) {
        const installments = invoiceInstallmentItems(inv)
        for (const inst of installments) {
          if (inst.status === 'PAID') continue
          const instDueDate = inst.dueDate instanceof Date ? inst.dueDate : new Date(inst.dueDate)
          if (Number.isNaN(instDueDate.getTime())) continue
          const dateStr = instDueDate.toISOString().slice(0, 10)
          const amountVnd = money(inst.totalAmount) * rate
          recordForecast(inv.direction === 'AR' ? receivable : payable, instDueDate, amountVnd, {
            date: dateStr,
            direction: inv.direction,
            amountVnd: moneyString(amountVnd),
            invoiceId: inv.id,
            installmentId: inst.id,
            invoiceNumber: inv.invoiceNumber ?? null,
            partnerName: inv.direction === 'AR' ? (inv.buyerName ?? null) : (inv.sellerName ?? null),
          })
        }
      } else if (inv.dueDate) {
        const dueDate = inv.dueDate instanceof Date ? inv.dueDate : new Date(inv.dueDate)
        if (!Number.isNaN(dueDate.getTime())) {
          const dateStr = dueDate.toISOString().slice(0, 10)
          const outstanding = money(inv.outstandingAmount)
          if (outstanding > 0) {
            const amountVnd = outstanding * rate
            recordForecast(inv.direction === 'AR' ? receivable : payable, dueDate, amountVnd, {
              date: dateStr,
              direction: inv.direction,
              amountVnd: moneyString(amountVnd),
              invoiceId: inv.id,
              installmentId: null,
              invoiceNumber: inv.invoiceNumber ?? null,
              partnerName: inv.direction === 'AR' ? (inv.buyerName ?? null) : (inv.sellerName ?? null),
            })
          }
        }
      } else {
        const aggregation = inv.direction === 'AR' ? receivable : payable
        const outstanding = money(inv.outstandingAmount) * rate
        if (outstanding > 0) {
          aggregation.undated.amount += outstanding
          aggregation.undated.count += 1
        }
      }
    }

    entries.sort((a, b) => a.date.localeCompare(b.date) || a.invoiceId.localeCompare(b.invoiceId))

    const dates = [...new Set([...receivable.byDate.keys(), ...payable.byDate.keys()])].sort()
    let receivableCumulative = 0
    let payableCumulative = 0
    let netCumulative = 0
    const receivablePoints: InvoiceForecastSeriesPointDto[] = []
    const payablePoints: InvoiceForecastSeriesPointDto[] = []
    const series: InvoiceForecastSeriesPointDto[] = []

    for (const date of dates) {
      const arAmount = receivable.byDate.get(date)?.amount ?? 0
      const apAmount = payable.byDate.get(date)?.amount ?? 0
      const netAmount = arAmount - apAmount
      receivableCumulative += arAmount
      payableCumulative += apAmount
      netCumulative += netAmount
      receivablePoints.push({ date, amount: moneyString(arAmount), count: receivable.byDate.get(date)?.count ?? 0, cumulative: moneyString(receivableCumulative), arAmount: moneyString(arAmount), apAmount: '0', netAmount: moneyString(arAmount) })
      payablePoints.push({ date, amount: moneyString(apAmount), count: payable.byDate.get(date)?.count ?? 0, cumulative: moneyString(payableCumulative), arAmount: '0', apAmount: moneyString(apAmount), netAmount: moneyString(-apAmount) })
      series.push({ date, amount: moneyString(netAmount), count: (receivable.byDate.get(date)?.count ?? 0) + (payable.byDate.get(date)?.count ?? 0), cumulative: moneyString(netCumulative), arAmount: moneyString(arAmount), apAmount: moneyString(apAmount), netAmount: moneyString(netAmount) })
    }

    const toBucket = (bucket: ForecastBucket): InvoiceForecastBucketDto => ({ amount: moneyString(bucket.amount), count: bucket.count })
    const toSeries = (aggregation: ForecastAggregation, points: InvoiceForecastSeriesPointDto[]): InvoiceForecastSeriesDto => ({
      overdue: toBucket(aggregation.overdue),
      undated: toBucket(aggregation.undated),
      beyondHorizon: toBucket(aggregation.beyondHorizon),
      points,
    })

    return {
      currency: 'VND',
      ratesStale: ratesDto?.stale ?? false,
      today: todayString,
      horizonDays,
      entries,
      receivable: toSeries(receivable, receivablePoints),
      payable: toSeries(payable, payablePoints),
      net: { points: series },
      series,
      totals: {
        arAmount: moneyString(receivable.totalAmount),
        apAmount: moneyString(payable.totalAmount),
        netAmount: moneyString(receivable.totalAmount - payable.totalAmount),
      },
    }
  }

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
    if (!invoice) throw invoiceNotFound('invoice.errors.invoice_not_found', 'Invoice not found')

    return mapInvoiceEntityToDetailDto(invoice)
  }

  async sendInvoice(scope: InvoiceScope, id: string, rawInput: InvoiceSendInput): Promise<InvoiceManualMutationResult> {
    const input = invoiceSendSchema.parse(rawInput)
    const invoice = await this.scopedPersistence.findById(Invoice, scope, id, {
      populate: ['company', 'lineItems', 'installments'] as never[],
      orderBy: {
        lineItems: { lineNumber: 'asc' },
        installments: { sequence: 'asc' },
      },
    })
    if (!invoice) throw invoiceNotFound('invoice.errors.invoice_not_found', 'Invoice not found')
    if (invoice.direction !== 'AR') throw invoiceBadRequest('invoice.errors.send_requires_ar', 'Only AR invoices can be sent')

    const { rawToken, tokenHash } = generateInvoiceTrackingToken()
    const { translate } = await resolveTranslations()
    const locale = await detectLocale()
    const email = createInvoiceEmail({
      invoice,
      rawToken,
      locale,
      translate,
    })

    try {
      await sendEmail({ to: input.email, subject: email.subject, react: email.react })
    } catch (err) {
      logger.error('Invoice email delivery failed', {
        invoiceId: invoice.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        err,
      })
      throw invoiceBadRequest('invoice.errors.email_delivery_failed', 'Invoice email delivery failed')
    }

    invoice.lastSentAt = new Date()
    invoice.emailTrackingTokenHash = tokenHash
    invoice.openedAt = null
    try {
      await this.em.flush()
    } catch (err) {
      logger.warn('Invoice send state persistence failed after delivery', {
        invoiceId: invoice.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        err,
      })
    }

    if (this.companyEmailsService) {
      try {
        await this.companyEmailsService.record(scope, { companyId: invoice.company.id, email: input.email })
      } catch (err) {
        logger.error('Invoice recipient memory failed', {
          invoiceId: invoice.id,
          companyId: invoice.company.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          err,
        })
      }
    }

    await emitInvoiceEvent('invoice.invoice.sent', {
      id: invoice.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return { invoice: mapInvoiceEntityToDetailDto(invoice) }
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
        buyerTaxCode: organization.taxCode?.trim() || null,
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
      if (!invoice) throw invoiceNotFound('invoice.errors.invoice_not_found', 'Invoice not found')
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
      invoice.buyerTaxCode = organization.taxCode?.trim() || null
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
    if (!invoice) throw invoiceNotFound('invoice.errors.invoice_not_found', 'Invoice not found')

    if (input.dueDate != null) {
      const invoiceDate = invoice.invoiceDate instanceof Date
        ? invoice.invoiceDate
        : new Date(invoice.invoiceDate)

      if (input.dueDate < invoiceDate) {
        throw invoiceBadRequest('invoice.errors.due_date_before_invoice_date', 'Due date cannot be before invoice date')
      }

      const maxDate = new Date(invoiceDate)
      maxDate.setDate(maxDate.getDate() + INVOICE_MAX_DUE_DAYS)
      if (input.dueDate > maxDate) {
        throw invoiceBadRequest(
          'invoice.errors.due_date_too_far',
          `Due date cannot be more than ${INVOICE_MAX_DUE_DAYS} days after invoice date`,
          { days: INVOICE_MAX_DUE_DAYS },
        )
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

  async updateReceivableSettlement(
    scope: InvoiceScope,
    id: string,
    rawInput: InvoiceSettlementUpdateInput,
  ): Promise<InvoiceSettlementUpdateResult> {
    const input = invoiceSettlementUpdateSchema.parse(rawInput)
    const invoice = await this.scopedPersistence.findById(Invoice, scope, id, {
      populate: ['lineItems', 'installments'] as never[],
      orderBy: {
        lineItems: { lineNumber: 'asc' },
        installments: { sequence: 'asc' },
      },
    })
    if (!invoice) throw invoiceNotFound('invoice.errors.invoice_not_found', 'Invoice not found')
    if (invoice.direction !== 'AR') throw invoiceBadRequest('invoice.errors.settlement_requires_ar', 'Direct settlement is allowed only for AR invoices')

    const installments = invoiceInstallmentItems(invoice)
    const now = new Date()
    if (installments.length === 0) {
      invoice.settlementStatus = input.settled ? 'SETTLED' : 'UNSETTLED'
    } else {
      for (const installment of installments) {
        installment.status = input.settled ? 'PAID' : 'PENDING'
        installment.paidAt = input.settled ? (installment.paidAt ?? now) : null
      }
    }
    recomputeInvoiceSettlementRollup(invoice)

    if (input.settled) {
      invoice.nonRecoverable = false
      invoice.nonRecoverableNote = null
      invoice.nonRecoverableAt = null
    }

    await this.em.flush()

    return { invoice: mapInvoiceEntityToDetailDto(invoice) }
  }

  async updateInstallmentPlan(scope: InvoiceScope, id: string, rawInput: InvoiceInstallmentPlanUpdateInput): Promise<InvoiceInstallmentPlanUpdateResult> {
    const input = invoiceInstallmentPlanUpdateSchema.parse(rawInput)
    const invoice = await this.scopedPersistence.findById(Invoice, scope, id, { populate: ['lineItems', 'installments'] as never[] })
    if (!invoice) throw invoiceNotFound('invoice.errors.invoice_not_found', 'Invoice not found')
    if (invoice.direction !== 'AR') throw invoiceBadRequest('invoice.errors.installments_requires_ar', 'Installment plans are allowed only for AR invoices')
    const principalTotal = input.installments.reduce((sum, item) => sum + money(item.principalAmount), 0)
    if (Math.abs(principalTotal - money(invoice.grossAmount)) > 0.0001) throw invoiceBadRequest('invoice.errors.installments_total_mismatch', 'Installment principal must match invoice total')
    await this.em.nativeDelete(InvoiceInstallment, { invoice })
    invoice.installments?.removeAll?.()
    let remaining = money(invoice.grossAmount)
    input.installments.forEach((item, index) => {
      const principal = moneyString(money(item.principalAmount))
      const interest = moneyString(roundMoney(remaining * item.interestRate / 100))
      const created = this.em.create(InvoiceInstallment, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        invoice,
        sequence: index + 1,
        principalAmount: principal,
        interestRate: String(item.interestRate),
        interestAmount: interest,
        totalAmount: moneyString(roundMoney(money(principal) + money(interest))),
        dueDate: item.dueDate,
        status: 'PENDING',
        paidAt: null,
        note: item.note ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      remaining = roundMoney(remaining - money(principal))
      invoice.installments?.add?.(created)
    })
    recomputeInvoiceSettlementRollup(invoice)
    await this.em.flush()
    return { invoice: mapInvoiceEntityToDetailDto(invoice) }
  }

  async updateInstallmentStatus(scope: InvoiceScope, id: string, installmentId: string, rawInput: InvoiceInstallmentStatusUpdateInput): Promise<InvoiceInstallmentStatusUpdateResult> {
    const input = invoiceInstallmentStatusUpdateSchema.parse(rawInput)
    const invoice = await this.scopedPersistence.findById(Invoice, scope, id, { populate: ['lineItems', 'installments'] as never[] })
    if (!invoice) throw invoiceNotFound('invoice.errors.invoice_not_found', 'Invoice not found')
    if (invoice.direction !== 'AR') throw invoiceBadRequest('invoice.errors.installments_requires_ar', 'Installments are allowed only for AR invoices')
    const installment = invoiceInstallmentItems(invoice).find((item) => item.id === installmentId)
    if (!installment) throw invoiceNotFound('invoice.errors.installment_not_found', 'Invoice installment not found')
    installment.status = input.paid ? 'PAID' : 'PENDING'
    installment.paidAt = input.paid ? (installment.paidAt ?? new Date()) : null
    recomputeInvoiceSettlementRollup(invoice)
    await this.em.flush()
    return { invoice: mapInvoiceEntityToDetailDto(invoice) }
  }

  async deleteInstallmentPlan(scope: InvoiceScope, id: string): Promise<InvoiceInstallmentPlanUpdateResult> {
    const invoice = await this.scopedPersistence.findById(Invoice, scope, id, { populate: ['lineItems', 'installments'] as never[] })
    if (!invoice) throw invoiceNotFound('invoice.errors.invoice_not_found', 'Invoice not found')
    if (invoice.direction !== 'AR') throw invoiceBadRequest('invoice.errors.installments_requires_ar', 'Installment plans are allowed only for AR invoices')
    await this.em.nativeDelete(InvoiceInstallment, { invoice })
    invoice.installments?.removeAll?.()
    invoice.settlementStatus = 'UNSETTLED'
    recomputeInvoiceSettlementRollup(invoice)
    await this.em.flush()
    return { invoice: mapInvoiceEntityToDetailDto(invoice) }
  }

  async applyInvoicePayment(
    scope: InvoiceScope,
    id: string,
    input: InvoicePaymentApplicationInput = {},
  ): Promise<InvoiceSettlementUpdateResult> {
    const invoice = await this.scopedPersistence.findById(Invoice, scope, id, {
      populate: ['lineItems', 'installments'] as never[],
      orderBy: {
        lineItems: { lineNumber: 'asc' },
        installments: { sequence: 'asc' },
      },
    })
    if (!invoice) throw invoiceNotFound('invoice.errors.invoice_not_found', 'Invoice not found')

    const installments = invoiceInstallmentItems(invoice)
    const now = new Date()

    if (invoice.direction === 'AP') {
      if (input.installmentId) {
        throw invoiceBadRequest('invoice.errors.settlement_requires_ar', 'AP payments must settle the full invoice')
      }
      for (const installment of installments) {
        installment.status = 'PAID'
        installment.paidAt = installment.paidAt ?? now
      }
      invoice.settlementStatus = 'SETTLED'
      recomputeInvoiceSettlementRollup(invoice)
      await this.em.flush()
      return { invoice: mapInvoiceEntityToDetailDto(invoice) }
    }

    if (input.installmentId) {
      const installment = installments.find((item) => item.id === input.installmentId)
      if (!installment) throw invoiceNotFound('invoice.errors.installment_not_found', 'Invoice installment not found')
      installment.status = 'PAID'
      installment.paidAt = installment.paidAt ?? now
    } else if (installments.length > 0) {
      for (const installment of installments) {
        installment.status = 'PAID'
        installment.paidAt = installment.paidAt ?? now
      }
    } else {
      invoice.settlementStatus = 'SETTLED'
    }

    recomputeInvoiceSettlementRollup(invoice)
    await this.em.flush()

    return { invoice: mapInvoiceEntityToDetailDto(invoice) }
  }

  async updateNonRecoverable(
    scope: InvoiceScope,
    id: string,
    rawInput: InvoiceNonRecoverableUpdateInput,
  ): Promise<InvoiceNonRecoverableUpdateResult> {
    const input = invoiceNonRecoverableUpdateSchema.parse(rawInput)
    const invoice = await this.scopedPersistence.findById(Invoice, scope, id, {
      populate: ['lineItems', 'installments'] as never[],
      orderBy: {
        lineItems: { lineNumber: 'asc' },
        installments: { sequence: 'asc' },
      },
    })
    if (!invoice) throw invoiceNotFound('invoice.errors.invoice_not_found', 'Invoice not found')
    if (invoice.direction !== 'AR') throw invoiceBadRequest('invoice.errors.non_recoverable_requires_ar', 'Non-recoverable state is allowed only for AR invoices')
    if (input.nonRecoverable && invoice.settlementStatus === 'SETTLED') {
      throw invoiceBadRequest('invoice.errors.settled_cannot_be_non_recoverable', 'Settled invoice cannot be marked non-recoverable')
    }

    invoice.nonRecoverable = input.nonRecoverable
    invoice.nonRecoverableNote = input.nonRecoverable ? input.note?.trim() ?? null : null
    invoice.nonRecoverableAt = input.nonRecoverable ? new Date() : null
    await this.em.flush()

    return { invoice: mapInvoiceEntityToDetailDto(invoice) }
  }

  async deleteManualInvoice(scope: InvoiceScope, id: string): Promise<InvoiceManualDeleteResult> {
    const invoice = await this.scopedPersistence.findById(Invoice, scope, id)
    if (!invoice) throw invoiceNotFound('invoice.errors.invoice_not_found', 'Invoice not found')
    this.assertManualInvoice(invoice)
    invoice.deletedAt = new Date()
    await this.em.flush()

    return { invoiceId: id, deleted: true }
  }

  private async loadOrganization(tx: EntityManager, scope: InvoiceScope): Promise<Organization> {
    const organization = await tx.findOne(Organization, {
      id: scope.organizationId,
      tenant: scope.tenantId,
      deletedAt: null,
    } as FilterQuery<Organization>)
    if (!organization) throw invoiceBadRequest('invoice.errors.organization_scope_invalid', 'Invoice organization scope is invalid')
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
    if (duplicate) throw invoiceConflict('invoice.errors.duplicate_manual_invoice', 'Duplicate manual invoice')
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
    if (invoice.origin !== 'MANUAL') throw invoiceBadRequest('invoice.errors.imported_invoice_immutable', 'Imported invoice cannot be changed')
    if (invoice.direction !== 'AP') throw invoiceBadRequest('invoice.errors.manual_ap_only', 'Only manual AP invoices can be changed')
  }
}

export function createInvoiceService(
  em: EntityManager,
  queryEngine: QueryEngine,
  scopedPersistence: InvoiceScopedPersistenceService,
  exchangeRatesService: InvoiceExchangeRatesService = createInvoiceExchangeRatesService(),
  companyEmailsService?: InvoiceCompanyEmailsService,
): InvoiceService {
  return new InvoiceService(em, queryEngine, scopedPersistence, exchangeRatesService, companyEmailsService)
}
