"use client"

/**
 * Time formatting for the transcript and the conversation list.
 *
 * All of it is locale-driven through `Intl`, so a chat read in Polish shows
 * Polish month names without this module shipping a single translated date
 * string.
 */

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
}

/** Whole days between two instants, in the reader's own timezone. */
export function daysBetween(from: Date, to: Date): number {
  const millisPerDay = 24 * 60 * 60 * 1000
  return Math.round((startOfDay(to) - startOfDay(from)) / millisPerDay)
}

export function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a) === startOfDay(b)
}

/** `09:41` — the timestamp beside a message. */
export function formatTimeOfDay(locale: string, value: Date): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(value)
}

/**
 * The date separator between days of a transcript. Today and yesterday are
 * named rather than dated, because a reader scanning back reads "yesterday"
 * faster than a date they have to convert.
 */
export function formatDateSeparator(
  locale: string,
  value: Date,
  labels: { today: string; yesterday: string },
): string {
  const distance = daysBetween(value, new Date())
  if (distance === 0) return labels.today
  if (distance === 1) return labels.yesterday
  const sameYear = value.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  }).format(value)
}

/**
 * The compact timestamp in a conversation row: a time today, a weekday this
 * week, a date beyond that. The row is narrow, so precision drops as the message
 * gets older.
 */
export function formatListTimestamp(locale: string, value: Date): string {
  const distance = daysBetween(value, new Date())
  if (distance === 0) return formatTimeOfDay(locale, value)
  if (distance < 7) return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(value)
  const sameYear = value.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : '2-digit',
  }).format(value)
}

/** The full instant, for the `title` and `dateTime` of a message timestamp. */
export function formatFullTimestamp(locale: string, value: Date): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(value)
}
