import type { TranslateWithFallbackFn } from './i18n/translate'

export type DateInput = string | number | Date | null | undefined

export type DisplayFormatOptions = {
  /**
   * BCP 47 locale; the runtime locale when omitted or empty. Pass `useLocale()`
   * client-side so the text follows the application language.
   */
  locale?: string | string[]
  /** Returned for an empty or unparseable value. Defaults to `null`. */
  fallback?: string | null
}

type DisplayFormatter = {
  (value: DateInput, options: DisplayFormatOptions & { fallback: string }): string
  (value: DateInput, options?: DisplayFormatOptions): string | null
}

function toValidDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function localeKey(locale: string | string[] | undefined): string {
  return Array.isArray(locale) ? locale.join(',') : (locale ?? '')
}

function createDisplayFormatter(format: Intl.DateTimeFormatOptions): DisplayFormatter {
  const formatters = new Map<string, Intl.DateTimeFormat>()
  return ((value: DateInput, options?: DisplayFormatOptions) => {
    const date = toValidDate(value)
    if (!date) return options?.fallback ?? null
    const locale = options?.locale || undefined
    const key = localeKey(locale)
    let formatter = formatters.get(key)
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, format)
      formatters.set(key, formatter)
    }
    return formatter.format(date)
  }) as DisplayFormatter
}

/** A calendar date, e.g. `Jun 9, 2026`. */
export const formatDate = createDisplayFormatter({ dateStyle: 'medium' })

/** A date without the year, for compact cards, e.g. `Jun 9`. */
export const formatShortDate = createDisplayFormatter({ month: 'short', day: 'numeric' })

/** A point in time, e.g. `Jun 9, 2026, 3:04 PM`. */
export const formatDateTime = createDisplayFormatter({ dateStyle: 'medium', timeStyle: 'short' })

/** A time of day, e.g. `3:04 PM`. */
export const formatTime = createDisplayFormatter({ timeStyle: 'short' })

export type FormatRelativeTimeOptions = {
  /**
   * Supplies the suffix only when the runtime has no `Intl.RelativeTimeFormat`.
   * Otherwise the number, unit name, plural form and suffix all come from
   * `Intl` in `locale` — pass `useLocale()` client-side so the text follows the
   * application language rather than the runtime one.
   */
  translate?: TranslateWithFallbackFn
  locale?: string | string[]
}

type RelativeTimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

export function formatRelativeTime(
  value?: string | null,
  options?: FormatRelativeTimeOptions
): string | null {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const now = Date.now()
  const diffSeconds = (date.getTime() - now) / 1000
  const absSeconds = Math.abs(diffSeconds)
  const translate = options?.translate

  const rtf =
    typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function'
      ? new Intl.RelativeTimeFormat(options?.locale, { numeric: 'auto' })
      : null

  const format = (unit: RelativeTimeUnit, divisor: number) => {
    const valueToFormat = Math.round(diffSeconds / divisor)
    if (rtf) return rtf.format(valueToFormat, unit)

    const isPast = diffSeconds < 0
    const fallbackSuffix = isPast ? 'ago' : 'from now'
    const suffixKey = isPast ? 'time.relative.ago' : 'time.relative.fromNow'
    const suffix = translate ? translate(suffixKey, fallbackSuffix) : fallbackSuffix
    const magnitude = Math.abs(valueToFormat)
    return `${magnitude} ${unit}${magnitude === 1 ? '' : 's'} ${suffix}`
  }

  if (absSeconds < 45) return format('second', 1)
  if (absSeconds < 45 * 60) return format('minute', 60)
  if (absSeconds < 24 * 60 * 60) return format('hour', 60 * 60)
  if (absSeconds < 7 * 24 * 60 * 60) return format('day', 24 * 60 * 60)
  if (absSeconds < 30 * 24 * 60 * 60) return format('week', 7 * 24 * 60 * 60)
  if (absSeconds < 365 * 24 * 60 * 60) return format('month', 30 * 24 * 60 * 60)
  return format('year', 365 * 24 * 60 * 60)
}
