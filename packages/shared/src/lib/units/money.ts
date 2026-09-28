import { CURRENCY_CODE_PATTERN } from '../validation/currency'

export type MoneyInput = string | number | null | undefined

export type MoneyFormatOptions = {
  /**
   * BCP 47 locale; the runtime locale when omitted or empty. Pass `useLocale()`
   * client-side so the text follows the application language.
   */
  locale?: string | string[]
  /** Returned for an empty or non-numeric amount. Defaults to `null`. */
  fallback?: string | null
}

type MoneyFormatter = {
  (value: MoneyInput, currency: string | null | undefined, options: MoneyFormatOptions & { fallback: string }): string
  (value: MoneyInput, currency?: string | null, options?: MoneyFormatOptions): string | null
}

function toFiniteAmount(value: MoneyInput): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) ? amount : null
}

function toCurrencyCode(currency: string | null | undefined): string | null {
  if (typeof currency !== 'string') return null
  const code = currency.trim().toUpperCase()
  return CURRENCY_CODE_PATTERN.test(code) ? code : null
}

const numberFormats = new Map<string, Intl.NumberFormat>()

function numberFormat(locale: string | string[] | undefined, currency: string | null): Intl.NumberFormat {
  const key = `${Array.isArray(locale) ? locale.join(',') : (locale ?? '')}|${currency ?? ''}`
  let format = numberFormats.get(key)
  if (!format) {
    format = currency
      ? new Intl.NumberFormat(locale, { style: 'currency', currency })
      : new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    numberFormats.set(key, format)
  }
  return format
}

/**
 * A money amount in its currency, e.g. `$1,234.50`. Without a usable currency
 * code the amount is shown with two decimals, followed by the code when there
 * is one the runtime cannot format.
 */
export const formatCurrency = ((value: MoneyInput, currency?: string | null, options?: MoneyFormatOptions) => {
  const amount = toFiniteAmount(value)
  if (amount === null) return options?.fallback ?? null
  const code = toCurrencyCode(currency)
  const locale = options?.locale || undefined
  if (code) {
    try {
      return numberFormat(locale, code).format(amount)
    } catch {
      // the runtime rejected the code: show the plain amount with the code instead
    }
  }
  const plain = numberFormat(locale, null).format(amount)
  return code ? `${plain} ${code}` : plain
}) as MoneyFormatter
