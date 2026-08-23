// Pure calendar arithmetic on `YYYY-MM-DD` strings. Isomorphic — the quick-add
// parser and the browser formatters use it as well as the server services, so
// it must stay free of Node/DOM/server imports.

export function parseIsoUtc(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`)
}

export function addDaysIso(iso: string, days: number): string {
  const date = parseIsoUtc(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function weekdayOfIso(iso: string): number {
  return parseIsoUtc(iso).getUTCDay()
}

/** `YYYY-MM-DD` for the given parts, or null when the parts do not name a real
 *  calendar date (e.g. 31 February). */
export function isoOrNull(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  const iso = date.toISOString().slice(0, 10)
  const [y, m, d] = iso.split('-').map(Number)
  return y === year && m === month && d === day ? iso : null
}

/** Last day number of the given month (0-based month index). */
export function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

export function addMonthsClamped(iso: string, months: number): string {
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  const day = Number(iso.slice(8, 10))
  const total = year * 12 + (month - 1) + months
  const targetYear = Math.floor(total / 12)
  const targetMonth = (total % 12) + 1
  const clampedDay = Math.min(day, lastDayOfMonth(targetYear, targetMonth - 1))
  return isoOrNull(targetYear, targetMonth, clampedDay) as string
}
