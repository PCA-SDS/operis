import {
  Invoice,
  InvoiceCompany,
  InvoiceInstallment,
  InvoiceLineItem,
  type InvoiceDirection,
} from './entities'

export type InvoiceListDto = {
  id: string
  sourceInvoiceId: string | null
  origin: string | null
  direction: InvoiceDirection
  companyId: string | null
  partnerName: string | null
  partnerTaxCode: string | null
  sellerTaxCode: string | null
  sellerName: string | null
  buyerTaxCode: string | null
  buyerName: string | null
  invoiceSymbol: string | null
  invoiceNumber: string | null
  invoiceCode: string | null
  invoiceDate: string | null
  dueDate: string | null
  dueDateSource: string | null
  currencyCode: string | null
  invoiceStatus: string | null
  netAmount: string | null
  vatAmount: string | null
  grossAmount: string | null
  hasReceived: boolean
  hasPaid: boolean
  settlementStatus: string | null
  settled: boolean
  paidAmount: string | null
  outstandingAmount: string | null
  nextDueDate: string | null
  hasInstallmentPlan: boolean
  nonRecoverable: boolean
  nonRecoverableNote: string | null
  nonRecoverableAt: string | null
  lastSentAt: string | null
  openedAt: string | null
  autoSettled: boolean
  autoPayExcluded: boolean
  createdAt: string | null
  updatedAt: string | null
}

export type InvoiceLineItemDto = {
  id: string
  lineNumber: number
  name: string
  unit: string | null
  quantity: string | null
  unitPrice: string | null
  discountAmount: string | null
  discountPercent: string | null
  vatRate: string | null
  vatAmount: string | null
  lineTotal: string
  createdAt: string | null
  updatedAt: string | null
}

export type InvoiceInstallmentDto = {
  id: string
  sequence: number
  principalAmount: string
  interestRate: string
  interestAmount: string
  totalAmount: string
  dueDate: string | null
  status: string
  paidAt: string | null
  note: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type InvoiceDetailDto = InvoiceListDto & {
  lineItems: InvoiceLineItemDto[]
  installments: InvoiceInstallmentDto[]
}

type InvoiceQueryRow = Record<string, unknown>

function readString(row: InvoiceQueryRow, snake: string, camel: string = snake): string | null {
  const value = row[snake] ?? row[camel]
  return typeof value === 'string' ? value : null
}

function readBoolean(row: InvoiceQueryRow, snake: string, camel: string = snake): boolean {
  return row[snake] === true || row[camel] === true
}

function readDate(row: InvoiceQueryRow, snake: string, camel: string): Date | string | null | undefined {
  return (row[snake] as Date | string | null | undefined) ?? (row[camel] as Date | string | null | undefined)
}

function readDirection(value: string | null): InvoiceDirection {
  return value === 'AP' ? 'AP' : 'AR'
}

function readCompanyId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const id = (value as Record<string, unknown>).id
    return typeof id === 'string' ? id : null
  }
  return null
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function partnerNameFor(direction: InvoiceDirection, sellerName: string | null, buyerName: string | null): string | null {
  return direction === 'AP' ? sellerName : buyerName
}

function partnerTaxCodeFor(
  direction: InvoiceDirection,
  sellerTaxCode: string | null,
  buyerTaxCode: string | null,
): string | null {
  return direction === 'AP' ? sellerTaxCode : buyerTaxCode
}

export function mapInvoiceQueryRowToListDto(row: InvoiceQueryRow): InvoiceListDto {
  const direction = readDirection(readString(row, 'direction'))
  const sellerTaxCode = readString(row, 'seller_tax_code', 'sellerTaxCode')
  const sellerName = readString(row, 'seller_name', 'sellerName')
  const buyerTaxCode = readString(row, 'buyer_tax_code', 'buyerTaxCode')
  const buyerName = readString(row, 'buyer_name', 'buyerName')
  const settlementStatus = readString(row, 'settlement_status', 'settlementStatus')

  return {
    id: readString(row, 'id') ?? '',
    sourceInvoiceId: readString(row, 'source_invoice_id', 'sourceInvoiceId'),
    origin: readString(row, 'origin'),
    direction,
    companyId: readCompanyId(row.company_id ?? row.company),
    partnerName: partnerNameFor(direction, sellerName, buyerName),
    partnerTaxCode: partnerTaxCodeFor(direction, sellerTaxCode, buyerTaxCode),
    sellerTaxCode,
    sellerName,
    buyerTaxCode,
    buyerName,
    invoiceSymbol: readString(row, 'invoice_symbol', 'invoiceSymbol'),
    invoiceNumber: readString(row, 'invoice_number', 'invoiceNumber'),
    invoiceCode: readString(row, 'invoice_code', 'invoiceCode'),
    invoiceDate: toIso(readDate(row, 'invoice_date', 'invoiceDate')),
    dueDate: toIso(readDate(row, 'due_date', 'dueDate')),
    dueDateSource: readString(row, 'due_date_source', 'dueDateSource'),
    currencyCode: readString(row, 'currency_code', 'currencyCode'),
    invoiceStatus: readString(row, 'invoice_status', 'invoiceStatus'),
    netAmount: readString(row, 'net_amount', 'netAmount'),
    vatAmount: readString(row, 'vat_amount', 'vatAmount'),
    grossAmount: readString(row, 'gross_amount', 'grossAmount'),
    hasReceived: readBoolean(row, 'has_received', 'hasReceived'),
    hasPaid: readBoolean(row, 'has_paid', 'hasPaid'),
    settlementStatus,
    settled: settlementStatus === 'SETTLED',
    paidAmount: readString(row, 'paid_amount', 'paidAmount'),
    outstandingAmount: readString(row, 'outstanding_amount', 'outstandingAmount'),
    nextDueDate: toIso(readDate(row, 'next_due_date', 'nextDueDate')),
    hasInstallmentPlan: readBoolean(row, 'has_installment_plan', 'hasInstallmentPlan'),
    nonRecoverable: readBoolean(row, 'non_recoverable', 'nonRecoverable'),
    nonRecoverableNote: readString(row, 'non_recoverable_note', 'nonRecoverableNote'),
    nonRecoverableAt: toIso(readDate(row, 'non_recoverable_at', 'nonRecoverableAt')),
    lastSentAt: toIso(readDate(row, 'last_sent_at', 'lastSentAt')),
    openedAt: toIso(readDate(row, 'opened_at', 'openedAt')),
    autoSettled: readBoolean(row, 'auto_settled', 'autoSettled'),
    autoPayExcluded: readBoolean(row, 'auto_pay_excluded', 'autoPayExcluded'),
    createdAt: toIso(readDate(row, 'created_at', 'createdAt')),
    updatedAt: toIso(readDate(row, 'updated_at', 'updatedAt')),
  }
}

function readCollectionItems<TItem>(value: unknown): TItem[] {
  if (Array.isArray(value)) return value as TItem[]
  if (value && typeof value === 'object' && typeof (value as { getItems?: unknown }).getItems === 'function') {
    return (value as { getItems: () => TItem[] }).getItems()
  }
  return []
}

function companyId(company: InvoiceCompany | string | null | undefined): string | null {
  if (typeof company === 'string') return company
  return company?.id ?? null
}

export function mapInvoiceEntityToListDto(invoice: Invoice): InvoiceListDto {
  return mapInvoiceQueryRowToListDto({
    id: invoice.id,
    sourceInvoiceId: invoice.sourceInvoiceId,
    origin: invoice.origin,
    direction: invoice.direction,
    company: companyId(invoice.company as InvoiceCompany | string | null | undefined),
    sellerTaxCode: invoice.sellerTaxCode ?? null,
    sellerName: invoice.sellerName,
    buyerTaxCode: invoice.buyerTaxCode ?? null,
    buyerName: invoice.buyerName,
    invoiceSymbol: invoice.invoiceSymbol ?? null,
    invoiceNumber: invoice.invoiceNumber,
    invoiceCode: invoice.invoiceCode ?? null,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate ?? null,
    dueDateSource: invoice.dueDateSource ?? null,
    currencyCode: invoice.currencyCode,
    invoiceStatus: invoice.invoiceStatus,
    netAmount: invoice.netAmount ?? null,
    vatAmount: invoice.vatAmount ?? null,
    grossAmount: invoice.grossAmount,
    hasReceived: invoice.hasReceived,
    hasPaid: invoice.hasPaid,
    settlementStatus: invoice.settlementStatus,
    paidAmount: invoice.paidAmount,
    outstandingAmount: invoice.outstandingAmount,
    nextDueDate: invoice.nextDueDate ?? null,
    hasInstallmentPlan: invoice.hasInstallmentPlan,
    nonRecoverable: invoice.nonRecoverable,
    nonRecoverableNote: invoice.nonRecoverableNote ?? null,
    nonRecoverableAt: invoice.nonRecoverableAt ?? null,
    lastSentAt: invoice.lastSentAt ?? null,
    openedAt: invoice.openedAt ?? null,
    autoSettled: invoice.autoSettled,
    autoPayExcluded: invoice.autoPayExcluded,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  })
}

export function mapInvoiceLineItemToDto(lineItem: InvoiceLineItem): InvoiceLineItemDto {
  return {
    id: lineItem.id,
    lineNumber: lineItem.lineNumber,
    name: lineItem.name,
    unit: lineItem.unit ?? null,
    quantity: lineItem.quantity ?? null,
    unitPrice: lineItem.unitPrice ?? null,
    discountAmount: lineItem.discountAmount ?? null,
    discountPercent: lineItem.discountPercent ?? null,
    vatRate: lineItem.vatRate ?? null,
    vatAmount: lineItem.vatAmount ?? null,
    lineTotal: lineItem.lineTotal,
    createdAt: toIso(lineItem.createdAt),
    updatedAt: toIso(lineItem.updatedAt),
  }
}

export function mapInvoiceInstallmentToDto(installment: InvoiceInstallment): InvoiceInstallmentDto {
  return {
    id: installment.id,
    sequence: installment.sequence,
    principalAmount: installment.principalAmount,
    interestRate: installment.interestRate,
    interestAmount: installment.interestAmount,
    totalAmount: installment.totalAmount,
    dueDate: toIso(installment.dueDate),
    status: installment.status,
    paidAt: toIso(installment.paidAt),
    note: installment.note ?? null,
    createdAt: toIso(installment.createdAt),
    updatedAt: toIso(installment.updatedAt),
  }
}

export function mapInvoiceEntityToDetailDto(invoice: Invoice): InvoiceDetailDto {
  const lineItems = readCollectionItems<InvoiceLineItem>(invoice.lineItems)
    .slice()
    .sort((a, b) => a.lineNumber - b.lineNumber)
    .map(mapInvoiceLineItemToDto)
  const installments = readCollectionItems<InvoiceInstallment>(invoice.installments)
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map(mapInvoiceInstallmentToDto)

  return {
    ...mapInvoiceEntityToListDto(invoice),
    lineItems,
    installments,
  }
}

export type InvoiceDirectionSummaryDto = {
  outstanding: string
  settled: string
  net: string
  total: string
  outstandingAmount: string
  settledAmount: string
  totalAmount: string
  nonRecoverableAmount?: string
}

export type InvoiceSummaryDto = {
  currency: 'VND'
  ar: InvoiceDirectionSummaryDto
  ap: InvoiceDirectionSummaryDto
  netPosition: string
  net: string
  netOutstanding: string
  ratesStale: boolean
}

export type InvoiceForecastEntryDto = {
  date: string
  direction: InvoiceDirection
  amountVnd: string
  invoiceId: string
  installmentId: string | null
  invoiceNumber: string | null
  partnerName: string | null
}

export type InvoiceForecastSeriesPointDto = {
  date: string
  arAmount: string
  apAmount: string
  netAmount: string
}

export type InvoiceForecastDto = {
  currency: 'VND'
  ratesStale: boolean
  entries: InvoiceForecastEntryDto[]
  series: InvoiceForecastSeriesPointDto[]
  totals: {
    arAmount: string
    apAmount: string
    netAmount: string
  }
}
