import { GdtProviderError } from './errors'
import type { GdtStream, GdtWireRecord } from './types'
import type { InvoiceDirection } from '../../data/entities'

export type NormalizedInvoiceLine = {
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
}

export type NormalizedInvoiceSource = {
  sourceInvoiceId: string
  direction: InvoiceDirection
  sellerTaxCode: string
  sellerName: string
  buyerTaxCode: string | null
  buyerName: string
  invoiceSymbol: string | null
  invoiceNumber: string
  invoiceCode: string | null
  invoiceDate: Date
  currencyCode: 'USD' | 'EUR' | 'GBP' | 'SGD' | 'AUD' | 'JPY' | 'CNY' | 'KRW' | 'THB' | 'VND'
  invoiceStatus: 'ACTIVE' | 'CANCELLED' | 'REPLACEMENT' | 'ADJUSTMENT' | 'REPLACED' | 'ADJUSTED'
  netAmount: string | null
  vatAmount: string | null
  grossAmount: string
  lines?: NormalizedInvoiceLine[]
}

export class MalformedGdtInvoiceError extends Error {
  readonly sourceIdentity?: string

  constructor(message: string, sourceIdentity?: string) {
    super(`[internal] Malformed GDT invoice${sourceIdentity ? ` ${sourceIdentity}` : ''}: ${message}`)
    this.name = 'MalformedGdtInvoiceError'
    this.sourceIdentity = sourceIdentity
  }
}

function value(record: GdtWireRecord, ...keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key]
  return undefined
}

function text(record: GdtWireRecord, ...keys: string[]): string | null {
  const result = value(record, ...keys)
  if (typeof result !== 'string' && typeof result !== 'number') return null
  const output = String(result).trim()
  return output || null
}

function requiredText(record: GdtWireRecord, label: string, ...keys: string[]): string {
  const result = text(record, ...keys)
  if (!result) throw new MalformedGdtInvoiceError(`${label} is required`)
  return result
}

function decimal(record: GdtWireRecord, label: string, ...keys: string[]): string | null {
  const result = text(record, ...keys)
  if (result === null) return null
  const normalized = result.replace(/,/g, '')
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) throw new MalformedGdtInvoiceError(`${label} is invalid`)
  return normalized
}

function requiredDecimal(record: GdtWireRecord, label: string, ...keys: string[]): string {
  const result = decimal(record, label, ...keys)
  if (result === null) throw new MalformedGdtInvoiceError(`${label} is required`)
  return result
}

function date(record: GdtWireRecord, label: string, ...keys: string[]): Date {
  const raw = requiredText(record, label, ...keys)
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw)
  if (Number.isNaN(parsed.getTime())) throw new MalformedGdtInvoiceError(`${label} is invalid`)
  return parsed
}

function enumValue<T extends string>(record: GdtWireRecord, fallback: T, label: string, values: readonly T[], ...keys: string[]): T {
  const candidate = (text(record, ...keys)?.toUpperCase() ?? fallback) as T
  if (!values.includes(candidate as T)) throw new MalformedGdtInvoiceError(`${label} is invalid`)
  return candidate as T
}

function lineItems(record: GdtWireRecord): NormalizedInvoiceLine[] | undefined {
  const raw = value(record, 'lines', 'lineItems', 'items')
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) throw new MalformedGdtInvoiceError('line items are invalid')
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') throw new MalformedGdtInvoiceError('line item is invalid')
    const line = item as GdtWireRecord
    return {
      lineNumber: Number(value(line, 'lineNumber', 'line_number', 'stt') ?? index + 1),
      name: requiredText(line, 'line name', 'name', 'itemName', 'item_name', 'description'),
      unit: text(line, 'unit', 'unitName', 'unit_name'),
      quantity: decimal(line, 'quantity', 'quantity', 'qty'),
      unitPrice: decimal(line, 'unit price', 'unitPrice', 'unit_price', 'price'),
      discountAmount: decimal(line, 'discount amount', 'discountAmount', 'discount_amount'),
      discountPercent: decimal(line, 'discount percent', 'discountPercent', 'discount_percent'),
      vatRate: decimal(line, 'VAT rate', 'vatRate', 'vat_rate', 'taxRate', 'tax_rate'),
      vatAmount: decimal(line, 'VAT amount', 'vatAmount', 'vat_amount', 'taxAmount', 'tax_amount'),
      lineTotal: requiredDecimal(line, 'line total', 'lineTotal', 'line_total', 'amount', 'total'),
    }
  })
}

export function buildGdtSourceInvoiceId(record: GdtWireRecord): string {
  const seller = requiredText(record, 'seller tax code', 'sellerTaxCode', 'seller_tax_code', 'sellerMst', 'seller_mst', 'nbmst')
  const template = requiredText(record, 'template code', 'templateCode', 'template_code', 'khhdon', 'invoiceTemplate')
  const series = requiredText(record, 'series', 'series', 'symbol', 'invoiceSeries', 'invoice_series', 'shdon')
  const number = requiredText(record, 'invoice number', 'invoiceNumber', 'invoice_number', 'number', 'sohdon')
  return `gdt:${seller}:${template}:${series}:${number}`
}

export function normalizeGdtInvoice(stream: GdtStream, record: GdtWireRecord): NormalizedInvoiceSource {
  try {
    const sourceInvoiceId = buildGdtSourceInvoiceId(record)
    const sellerTaxCode = requiredText(record, 'seller tax code', 'sellerTaxCode', 'seller_tax_code', 'sellerMst', 'seller_mst', 'nbmst')
    const sellerName = requiredText(record, 'seller name', 'sellerName', 'seller_name', 'seller', 'tennguoiban')
    const buyerTaxCode = text(record, 'buyerTaxCode', 'buyer_tax_code', 'buyerMst', 'buyer_mst', 'nmst')
    if (stream === 'sold' && !buyerTaxCode) throw new MalformedGdtInvoiceError('buyer tax code is required', sourceInvoiceId)
    const buyerName = requiredText(record, 'buyer name', 'buyerName', 'buyer_name', 'buyer', 'tennguoimua')
    return {
      sourceInvoiceId,
      direction: stream === 'sold' ? 'AR' : 'AP',
      sellerTaxCode,
      sellerName,
      buyerTaxCode,
      buyerName,
      invoiceSymbol: text(record, 'invoiceSymbol', 'invoice_symbol', 'symbol', 'series'),
      invoiceNumber: requiredText(record, 'invoice number', 'invoiceNumber', 'invoice_number', 'number', 'sohdon'),
      invoiceCode: text(record, 'invoiceCode', 'invoice_code', 'code', 'lookupCode'),
      invoiceDate: date(record, 'invoice date', 'invoiceDate', 'invoice_date', 'date', 'ngaylap'),
      currencyCode: enumValue(record, 'VND', 'currency', ['USD', 'EUR', 'GBP', 'SGD', 'AUD', 'JPY', 'CNY', 'KRW', 'THB', 'VND'] as const, 'currencyCode', 'currency_code', 'currency'),
      invoiceStatus: enumValue(record, 'ACTIVE', 'invoice status', ['ACTIVE', 'CANCELLED', 'REPLACEMENT', 'ADJUSTMENT', 'REPLACED', 'ADJUSTED'] as const, 'invoiceStatus', 'invoice_status', 'status'),
      netAmount: decimal(record, 'net amount', 'netAmount', 'net_amount', 'beforeTax', 'before_tax'),
      vatAmount: decimal(record, 'VAT amount', 'vatAmount', 'vat_amount', 'taxAmount', 'tax_amount'),
      grossAmount: requiredDecimal(record, 'gross amount', 'grossAmount', 'gross_amount', 'totalAmount', 'total_amount', 'amount'),
      lines: lineItems(record),
    }
  } catch (error) {
    if (error instanceof MalformedGdtInvoiceError) throw error
    throw new MalformedGdtInvoiceError(error instanceof Error ? error.message : 'invalid record')
  }
}

export function normalizeGdtInvoiceOrThrow(stream: GdtStream, record: GdtWireRecord): NormalizedInvoiceSource {
  try { return normalizeGdtInvoice(stream, record) } catch (error) {
    if (error instanceof MalformedGdtInvoiceError) throw error
    throw new GdtProviderError('invalid_response', 'Unable to normalize GDT invoice', error)
  }
}

export class InvoiceNormalizer {
  normalize(stream: GdtStream, record: GdtWireRecord): NormalizedInvoiceSource {
    return normalizeGdtInvoice(stream, record)
  }
}
