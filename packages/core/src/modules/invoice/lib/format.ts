export function invoiceLocale(currency: string | null | undefined): string {
  return currency?.toUpperCase() === 'VND' ? 'vi-VN' : 'en-US'
}

export function formatInvoiceMoney(
  value: string | number | null | undefined,
  currency: string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return '—'
  const amount = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(amount)) return typeof value === 'string' ? value : '—'
  const code = currency?.toUpperCase()
  if (!code) return formatInvoiceNumber(amount, currency)
  return new Intl.NumberFormat(invoiceLocale(code), {
    style: 'currency',
    currency: code,
    minimumFractionDigits: code === 'VND' ? 0 : 2,
    maximumFractionDigits: code === 'VND' ? 0 : 2,
  }).format(amount)
}

export function formatInvoiceNumber(
  value: string | number | null | undefined,
  currency?: string | null,
): string {
  if (value === null || value === undefined || value === '') return '—'
  const amount = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(amount)) return typeof value === 'string' ? value : '—'
  return new Intl.NumberFormat(invoiceLocale(currency), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(amount)
}

export function formatInvoiceRate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const rate = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(rate)) return '—'
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(rate)}%`
}
