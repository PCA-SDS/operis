import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { SortDir, type QueryOptions } from '@open-mercato/shared/lib/query/types'

import { invoiceListQuerySchema, type InvoiceListQuery } from './validators'

export const invoiceListQueryFields = [
  'id',
  'source_invoice_id',
  'origin',
  'direction',
  'company_id',
  'seller_tax_code',
  'seller_name',
  'buyer_tax_code',
  'buyer_name',
  'invoice_symbol',
  'invoice_number',
  'invoice_code',
  'invoice_date',
  'due_date',
  'due_date_source',
  'currency_code',
  'invoice_status',
  'net_amount',
  'vat_amount',
  'gross_amount',
  'has_received',
  'has_paid',
  'settlement_status',
  'paid_amount',
  'outstanding_amount',
  'next_due_date',
  'has_installment_plan',
  'non_recoverable',
  'non_recoverable_note',
  'non_recoverable_at',
  'last_sent_at',
  'opened_at',
  'auto_settled',
  'auto_pay_excluded',
  'created_at',
  'updated_at',
] as const

const invoiceSortFieldMap: Record<InvoiceListQuery['sortField'], string> = {
  invoiceDate: 'invoice_date',
  dueDate: 'due_date',
  invoiceNumber: 'invoice_number',
  grossAmount: 'gross_amount',
  settlementStatus: 'settlement_status',
  invoiceStatus: 'invoice_status',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
}

function stableSort(query: InvoiceListQuery): NonNullable<QueryOptions['sort']> {
  const field = invoiceSortFieldMap[query.sortField]
  const dir = query.sortDir === 'asc' ? SortDir.Asc : SortDir.Desc
  return field === 'id'
    ? [{ field: 'id', dir }]
    : [{ field, dir }, { field: 'id', dir: SortDir.Asc }]
}

function searchFilter(search: string): NonNullable<QueryOptions['filters']> {
  const term = `%${escapeLikePattern(search.trim())}%`
  return {
    $or: [
      { source_invoice_id: { $ilike: term } },
      { seller_name: { $ilike: term } },
      { buyer_name: { $ilike: term } },
      { invoice_number: { $ilike: term } },
      { invoice_symbol: { $ilike: term } },
      { invoice_code: { $ilike: term } },
    ],
  }
}

export function parseInvoiceListQuery(query: unknown): InvoiceListQuery {
  return invoiceListQuerySchema.parse(query)
}

export function buildInvoiceListFilters(query: InvoiceListQuery): NonNullable<QueryOptions['filters']> {
  const filters: Record<string, unknown> = {}

  if (query.direction) filters.direction = { $eq: query.direction }
  if (query.status) filters.invoice_status = { $eq: query.status }
  if (query.settlement === 'settled') filters.settlement_status = { $eq: 'SETTLED' }
  if (query.settlement === 'unsettled') filters.settlement_status = { $ne: 'SETTLED' }
  if (query.recoverability === 'recoverable') filters.non_recoverable = { $eq: false }
  if (query.recoverability === 'nonRecoverable') filters.non_recoverable = { $eq: true }
  if (query.partnerId) filters.company_id = { $eq: query.partnerId }
  if (query.fromDate || query.toDate) {
    filters.invoice_date = {
      ...(query.fromDate ? { $gte: query.fromDate } : {}),
      ...(query.toDate ? { $lte: query.toDate } : {}),
    }
  }
  if (query.search?.trim()) {
    Object.assign(filters, searchFilter(query.search))
  }

  return filters
}

export function buildInvoiceListQueryOptions(query: InvoiceListQuery): Pick<QueryOptions, 'fields' | 'filters' | 'sort' | 'page'> {
  return {
    fields: [...invoiceListQueryFields],
    filters: buildInvoiceListFilters(query),
    sort: stableSort(query),
    page: {
      page: query.page,
      pageSize: query.pageSize,
    },
  }
}
