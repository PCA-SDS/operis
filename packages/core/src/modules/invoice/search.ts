import type {
  SearchBuildContext,
  SearchIndexSource,
  SearchModuleConfig,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

function pickString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function appendLine(lines: string[], label: string, value: unknown): void {
  if (value === null || value === undefined) return
  const text = value instanceof Date ? value.toISOString() : String(value)
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

function joinSubtitle(...parts: Array<string | null | undefined>): string | undefined {
  const text = parts.filter((part): part is string => Boolean(part))
  return text.length > 0 ? text.join(' | ') : undefined
}

function buildSource(
  ctx: SearchBuildContext,
  presenter: SearchResultPresenter,
  lines: string[],
): SearchIndexSource | null {
  if (!lines.length) return null
  return {
    text: lines,
    presenter,
    checksumSource: { record: ctx.record, customFields: ctx.customFields },
  }
}

type Translate = (key: string, fallback: string) => string

function companyPresenter(t: Translate, record: Record<string, unknown>): SearchResultPresenter {
  return {
    title: pickString(record.name) ?? t('invoice.search.badge.company', 'Invoice company'),
    subtitle: joinSubtitle(
      pickString(record.tax_code, record.taxCode),
      pickString(record.country_code, record.countryCode),
    ),
    icon: 'building-2',
    badge: t('invoice.search.badge.company', 'Invoice company'),
  }
}

function invoicePresenter(t: Translate, record: Record<string, unknown>): SearchResultPresenter {
  const invoiceNumber = pickString(record.invoice_number, record.invoiceNumber)
  const direction = pickString(record.direction)
  const status = pickString(record.invoice_status, record.invoiceStatus)
  return {
    title:
      invoiceNumber ??
      pickString(record.source_invoice_id, record.sourceInvoiceId) ??
      t('invoice.search.badge.invoice', 'Invoice'),
    subtitle: joinSubtitle(
      direction,
      status,
      pickString(record.seller_name, record.sellerName),
      pickString(record.buyer_name, record.buyerName),
    ),
    icon: 'file-text',
    badge: t('invoice.search.badge.invoice', 'Invoice'),
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'invoice:invoice_company',
      aclFeatures: ['invoice.view'],
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Country', record.country_code ?? record.countryCode)
        return buildSource(ctx, companyPresenter(t, record), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return companyPresenter(t, ctx.record)
      },
      resolveUrl: async (ctx) => `/backend/invoice/companies/${encodeURIComponent(String(ctx.record.id))}`,
      fieldPolicy: {
        searchable: ['name', 'country_code'],
        hashOnly: ['tax_code'],
        excluded: ['search_text'],
      },
    },
    {
      entityId: 'invoice:invoice',
      aclFeatures: ['invoice.view'],
      enabled: true,
      priority: 8,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Source invoice id', record.source_invoice_id ?? record.sourceInvoiceId)
        appendLine(lines, 'Seller', record.seller_name ?? record.sellerName)
        appendLine(lines, 'Buyer', record.buyer_name ?? record.buyerName)
        appendLine(lines, 'Invoice number', record.invoice_number ?? record.invoiceNumber)
        appendLine(lines, 'Invoice symbol', record.invoice_symbol ?? record.invoiceSymbol)
        appendLine(lines, 'Invoice code', record.invoice_code ?? record.invoiceCode)
        appendLine(lines, 'Direction', record.direction)
        appendLine(lines, 'Status', record.invoice_status ?? record.invoiceStatus)
        appendLine(lines, 'Settlement', record.settlement_status ?? record.settlementStatus)
        return buildSource(ctx, invoicePresenter(t, record), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return invoicePresenter(t, ctx.record)
      },
      resolveUrl: async (ctx) => `/backend/invoice/all/${encodeURIComponent(String(ctx.record.id))}`,
      fieldPolicy: {
        searchable: [
          'source_invoice_id',
          'seller_name',
          'buyer_name',
          'invoice_number',
          'invoice_symbol',
          'invoice_code',
          'direction',
          'invoice_status',
          'settlement_status',
        ],
        hashOnly: ['seller_tax_code', 'buyer_tax_code'],
        excluded: ['email_tracking_token_hash', 'search_text'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
