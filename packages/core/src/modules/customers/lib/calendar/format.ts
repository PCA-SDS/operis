const DATE_OPTIONS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }

const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

const NON_CANONICAL_INTL_SPACING = /[\u00a0\u2007\u2009\u202f]/g

function normalizeIntlSpacing(value: string): string {
  return value.replace(NON_CANONICAL_INTL_SPACING, ' ')
}

export function formatDateLabel(locale: string, date: Date): string {
  return new Intl.DateTimeFormat(locale, DATE_OPTIONS).format(date)
}

export function formatDateRangeLabel(locale: string, from: Date, to: Date): string {
  const formatter = new Intl.DateTimeFormat(locale, DATE_OPTIONS)
  try {
    return normalizeIntlSpacing(formatter.formatRange(from, to))
  } catch {
    return normalizeIntlSpacing(`${formatter.format(from)} – ${formatter.format(to)}`)
  }
}

export function formatTimeLabel(locale: string, date: Date): string {
  return normalizeIntlSpacing(new Intl.DateTimeFormat(locale, TIME_OPTIONS).format(date))
}

export function formatTimeRangeLabel(locale: string, start: Date, end: Date): string {
  const formatter = new Intl.DateTimeFormat(locale, TIME_OPTIONS)
  try {
    return normalizeIntlSpacing(formatter.formatRange(start, end))
  } catch {
    return normalizeIntlSpacing(`${formatter.format(start)} – ${formatter.format(end)}`)
  }
}

const DAY_HEADING_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}

const MONTH_HEADING_OPTIONS: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' }

/**
 * The contextual heading a calendar shows for the range it is displaying.
 *
 * Week ranges go through `formatRange`, which collapses a shared month and year
 * ("24 – 30 August 2026") and expands them only when the week straddles a
 * boundary ("31 August – 6 September 2026").
 */
export function formatHeaderLabel(
  locale: string,
  view: 'day' | 'week' | 'month' | 'agenda',
  anchor: Date,
  range: { from: Date; to: Date },
): string {
  if (view === 'day') {
    return normalizeIntlSpacing(new Intl.DateTimeFormat(locale, DAY_HEADING_OPTIONS).format(anchor))
  }
  if (view === 'month') {
    return normalizeIntlSpacing(new Intl.DateTimeFormat(locale, MONTH_HEADING_OPTIONS).format(anchor))
  }
  return formatDateRangeLabel(locale, range.from, range.to)
}
