import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { parseIsoUtc } from './calendar'

export { addDaysIso } from './calendar'

/** Parse a `YYYY-MM-DD` calendar day into the UTC midnight instant the ORM
 *  stores for a `date` column. */
export function parseCalendarDate(value: string): Date {
  return parseIsoUtc(value)
}

export function dateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null
  return parseCalendarDate(value)
}

/** Render a stored date column back to `YYYY-MM-DD`. */
export function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 10)
  if (Number.isNaN(value.getTime())) return null
  return value.toISOString().slice(0, 10)
}

export function isoInstant(value: Date | null | undefined): string | null {
  if (!value) return null
  if (Number.isNaN(value.getTime())) return null
  return value.toISOString()
}

export function normalizeText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Canonical ordering for id arrays. Undo snapshots compare id sets for
 *  equality, so the order has to be stable and byte-wise — a locale-aware
 *  comparison would make the same set look different under another locale. */
export function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function resolveTimeZone(tz: string | null | undefined): string {
  if (!tz) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    throw badRequest('[internal] tz must be a valid IANA timezone name')
  }
}

/** "Today" as a calendar day in the given zone. */
export function todayInTimeZone(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now)
}

export type ZonedWallClock = {
  date: string
  time: string
}

const WALL_CLOCK_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}

function wallClockParts(instant: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', { ...WALL_CLOCK_FORMAT, timeZone }).formatToParts(instant)
  const map: Record<string, string> = {}
  for (const part of parts) map[part.type] = part.value
  if (map.hour === '24') map.hour = '00'
  return map
}

/** Resolve an instant to the calendar day + wall-clock time an observer in
 *  `timeZone` would read off a clock. */
export function zonedWallClock(instant: Date, timeZone: string): ZonedWallClock {
  const parts = wallClockParts(instant, timeZone)
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  }
}

/** The UTC instant at which a calendar day starts in `timeZone`. Two passes so
 *  a DST transition inside the day still resolves to the right offset. */
export function zonedDayStartUtc(day: string, timeZone: string): Date {
  const target = parseCalendarDate(day).getTime()
  const offsetAt = (ms: number): number => {
    const parts = wallClockParts(new Date(ms), timeZone)
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    )
    return asUtc - ms
  }
  const first = target - offsetAt(target)
  return new Date(target - offsetAt(first))
}
