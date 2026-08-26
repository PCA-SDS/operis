import type { CalendarItem, CalendarRange } from '../../components/calendar/types'
import { addCalendarDays, localDayKey } from './time'

const MAX_OCCURRENCES_PER_WINDOW = 100
/** Hard stop on the generator so a malformed rule can never spin forever. */
const MAX_STEPS = 5000

const WEEKDAY_TOKENS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

const UNTIL_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/
const DATE_ONLY_PATTERN = /^(\d{4})(\d{2})(\d{2})$/

export type RecurrenceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export type ParsedRecurrenceRule = {
  freq: RecurrenceFrequency
  interval: number
  byDay: number[] | null
  count: number | null
  until: Date | null
  /** Local day keys (`YYYY-MM-DD`) this series skips. */
  exceptions: string[]
}

function parseUntil(value: string): Date | null {
  const match = UNTIL_PATTERN.exec(value)
  if (match) {
    const [, year, month, day, hours, minutes, seconds] = match
    const parsed = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds)),
    )
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const dateOnly = DATE_ONLY_PATTERN.exec(value)
  if (!dateOnly) return null
  const [, year, month, day] = dateOnly
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parseExceptionDates(value: string): string[] | null {
  const tokens = value
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
  if (tokens.length === 0) return null
  const keys: string[] = []
  for (const token of tokens) {
    const dateOnly = DATE_ONLY_PATTERN.exec(token.slice(0, 8))
    if (!dateOnly) return null
    const [, year, month, day] = dateOnly
    keys.push(`${year}-${month}-${day}`)
  }
  return keys
}

export function parseRecurrenceRule(rule: string): ParsedRecurrenceRule | null {
  const parts = rule
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  if (parts.length === 0) return null

  let freq: RecurrenceFrequency | null = null
  let interval = 1
  let byDay: number[] | null = null
  let count: number | null = null
  let until: Date | null = null
  let exceptions: string[] = []

  for (const part of parts) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex <= 0) return null
    const key = part.slice(0, separatorIndex).toUpperCase()
    const value = part.slice(separatorIndex + 1)

    if (key === 'FREQ') {
      if (value !== 'DAILY' && value !== 'WEEKLY' && value !== 'MONTHLY' && value !== 'YEARLY') return null
      freq = value
    } else if (key === 'INTERVAL') {
      const parsed = Number(value)
      if (!Number.isInteger(parsed) || parsed < 1) return null
      interval = parsed
    } else if (key === 'BYDAY') {
      const tokens = value
        .split(',')
        .map((token) => token.trim().toUpperCase())
        .filter((token) => token.length > 0)
      if (tokens.length === 0) return null
      const weekdays: number[] = []
      for (const token of tokens) {
        const weekday = WEEKDAY_TOKENS.indexOf(token as (typeof WEEKDAY_TOKENS)[number])
        if (weekday === -1) return null
        weekdays.push(weekday)
      }
      byDay = [...new Set(weekdays)].sort((first, second) => first - second)
    } else if (key === 'COUNT') {
      const parsedCount = Number(value)
      if (!Number.isInteger(parsedCount) || parsedCount < 1) return null
      count = parsedCount
    } else if (key === 'UNTIL') {
      const parsedUntil = parseUntil(value)
      if (!parsedUntil) return null
      until = parsedUntil
    } else if (key === 'EXDATE') {
      const parsedExceptions = parseExceptionDates(value)
      if (!parsedExceptions) return null
      exceptions = parsedExceptions
    } else {
      // Unknown component: refuse rather than silently expanding something the
      // producer meant differently.
      return null
    }
  }

  if (!freq) return null
  // BYDAY only carries meaning for weekly recurrence in the subset we produce.
  if (byDay && freq !== 'WEEKLY') byDay = null
  return { freq, interval, byDay, count, until, exceptions }
}

function parseRecurrenceEndTime(rawRecurrenceEnd: string | null | undefined): number | null {
  if (typeof rawRecurrenceEnd !== 'string' || rawRecurrenceEnd.length === 0) return null
  const parsed = new Date(rawRecurrenceEnd)
  if (Number.isNaN(parsed.getTime())) return null
  const endOfDayLocal = new Date(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
    23,
    59,
    59,
    999,
  )
  return endOfDayLocal.getTime()
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

/**
 * Add months while holding the anchor day of month, clamped to the target
 * month's length — so a 31st-of-the-month series lands on 28/29 February and
 * 30 April rather than skidding into the next month.
 */
function addMonthsClamped(reference: Date, anchorDay: number, months: number): Date {
  const total = reference.getFullYear() * 12 + reference.getMonth() + months
  const year = Math.floor(total / 12)
  const monthIndex = ((total % 12) + 12) % 12
  const day = Math.min(anchorDay, lastDayOfMonth(year, monthIndex))
  return new Date(
    year,
    monthIndex,
    day,
    reference.getHours(),
    reference.getMinutes(),
    reference.getSeconds(),
    reference.getMilliseconds(),
  )
}

/** Same clamping for yearly series, so 29 February degrades to 28 February. */
function addYearsClamped(reference: Date, anchorMonth: number, anchorDay: number, years: number): Date {
  const year = reference.getFullYear() + years
  const day = Math.min(anchorDay, lastDayOfMonth(year, anchorMonth))
  return new Date(
    year,
    anchorMonth,
    day,
    reference.getHours(),
    reference.getMinutes(),
    reference.getSeconds(),
    reference.getMilliseconds(),
  )
}

function startOfWeekLocal(date: Date): Date {
  const weekday = date.getDay()
  return addCalendarDays(new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()), -weekday)
}

/**
 * Occurrence starts for a series, in chronological order.
 *
 * Stepping is frequency-aware — a yearly rule advances a year at a time rather
 * than walking every day — so a wide window stays cheap.
 */
export function* occurrenceStarts(
  seriesStart: Date,
  rule: ParsedRecurrenceRule,
  hardLimitMs: number,
): Generator<Date> {
  const anchorDay = seriesStart.getDate()
  const anchorMonth = seriesStart.getMonth()

  if (rule.freq === 'WEEKLY' && rule.byDay) {
    let weekStart = startOfWeekLocal(seriesStart)
    for (let step = 0; step < MAX_STEPS; step += 1) {
      for (const weekday of rule.byDay) {
        const candidate = addCalendarDays(weekStart, weekday)
        if (candidate.getTime() < seriesStart.getTime()) continue
        if (candidate.getTime() > hardLimitMs) return
        yield candidate
      }
      weekStart = addCalendarDays(weekStart, 7 * rule.interval)
      if (weekStart.getTime() > hardLimitMs) return
    }
    return
  }

  for (let step = 0; step < MAX_STEPS; step += 1) {
    let candidate: Date
    if (rule.freq === 'DAILY') candidate = addCalendarDays(seriesStart, step * rule.interval)
    else if (rule.freq === 'WEEKLY') candidate = addCalendarDays(seriesStart, step * 7 * rule.interval)
    else if (rule.freq === 'MONTHLY') candidate = addMonthsClamped(seriesStart, anchorDay, step * rule.interval)
    else candidate = addYearsClamped(seriesStart, anchorMonth, anchorDay, step * rule.interval)

    if (candidate.getTime() > hardLimitMs) return
    yield candidate
  }
}

export function expandOccurrences(item: CalendarItem, range: CalendarRange): CalendarItem[] {
  const rawRule = item.raw.recurrenceRule
  if (typeof rawRule !== 'string' || rawRule.trim().length === 0) return [item]
  const rule = parseRecurrenceRule(rawRule)
  // An unrecognised rule degrades to the single stored event rather than
  // throwing or silently multiplying it.
  if (!rule) return [item]

  const durationMs = item.end.getTime() - item.start.getTime()
  const recurrenceEndTime = parseRecurrenceEndTime(item.raw.recurrenceEnd)
  const untilTime = rule.until ? rule.until.getTime() : null

  const limits = [range.to.getTime()]
  if (untilTime !== null) limits.push(untilTime)
  if (recurrenceEndTime !== null) limits.push(recurrenceEndTime)
  const hardLimitMs = Math.min(...limits)

  const exceptions = new Set(rule.exceptions)
  const occurrences: CalendarItem[] = []
  let occurrenceIndex = 0

  for (const occurrenceStart of occurrenceStarts(item.start, rule, hardLimitMs)) {
    if (rule.count !== null && occurrenceIndex >= rule.count) break
    occurrenceIndex += 1

    // An excepted date consumes its slot in COUNT but renders nothing.
    if (exceptions.has(localDayKey(occurrenceStart))) continue

    const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs)
    if (occurrenceStart.getTime() > range.to.getTime()) break
    if (occurrenceEnd.getTime() <= range.from.getTime()) continue

    occurrences.push({
      ...item,
      id: `${item.id}:${occurrenceIndex - 1}`,
      start: occurrenceStart,
      end: occurrenceEnd,
      isRecurringOccurrence: true,
    })
    if (occurrences.length >= MAX_OCCURRENCES_PER_WINDOW) break
  }

  return occurrences
}
