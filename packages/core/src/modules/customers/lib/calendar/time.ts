// Wall-clock time helpers for calendar geometry.
//
// Calendars position events by the time shown on a clock, not by elapsed
// milliseconds: a 09:00 meeting sits on the 09:00 line on every day of the
// year, including the days a DST transition makes 23 or 25 hours long. Every
// helper here therefore works in wall-clock minutes from local midnight and
// builds instants through the Date constructor, which performs the local-time
// to instant mapping the platform defines.
//
// Persisted values stay UTC ISO strings; conversion happens only here.

export const MINUTES_PER_HOUR = 60
export const HOURS_PER_DAY = 24
export const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR

/** The timezone the calendar renders in, resolved from the runtime. */
export function resolveCalendarTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function formatTimeZoneLabel(reference: Date = new Date()): string {
  const timeZone = resolveCalendarTimeZone()
  const offsetMinutes = -reference.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const hours = Math.floor(absolute / MINUTES_PER_HOUR)
  const minutes = absolute % MINUTES_PER_HOUR
  const offset = minutes > 0 ? `${sign}${hours}:${String(minutes).padStart(2, '0')}` : `${sign}${hours}`
  return `${timeZone} (GMT${offset})`
}

/** Local midnight of the day containing `date`. */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

/** Minutes from local midnight as read off a clock — always 0..1440. */
export function wallMinutes(date: Date): number {
  return date.getHours() * MINUTES_PER_HOUR + date.getMinutes() + date.getSeconds() / 60
}

/**
 * The instant at `minutes` past midnight on `day`'s calendar date.
 *
 * Minutes beyond a day roll into following dates, which is what a drag ending
 * past midnight means. Times inside a spring-forward gap resolve the way the
 * Date constructor resolves them rather than throwing.
 */
export function atWallMinutes(day: Date, minutes: number): Date {
  const whole = Math.floor(minutes)
  const dayOffset = Math.floor(whole / MINUTES_PER_DAY)
  const withinDay = whole - dayOffset * MINUTES_PER_DAY
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() + dayOffset,
    Math.floor(withinDay / MINUTES_PER_HOUR),
    withinDay % MINUTES_PER_HOUR,
    0,
    0,
  )
}

/** Calendar days between two dates, ignoring time of day and DST length. */
export function calendarDaysBetween(from: Date, to: Date): number {
  const fromMidnight = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const toMidnight = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((toMidnight - fromMidnight) / (MINUTES_PER_DAY * 60_000))
}

/** Add whole calendar days, holding the wall-clock time steady across DST. */
export function addCalendarDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  )
}

/** Stable `YYYY-MM-DD` key in local time — safe as a Map key and sort key. */
export function localDayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isSameLocalDay(first: Date, second: Date): boolean {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  )
}

/** Round wall-clock minutes to the nearest `snap`, clamped to a single day. */
export function snapMinutes(minutes: number, snap: number): number {
  if (snap <= 0) return clampDayMinutes(minutes)
  return clampDayMinutes(Math.round(minutes / snap) * snap)
}

export function clampDayMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes < 0) return 0
  if (minutes > MINUTES_PER_DAY) return MINUTES_PER_DAY
  return minutes
}
