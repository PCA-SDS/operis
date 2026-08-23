// Task recurrence. Calendar-based (a date, never a stored UTC instant), so
// occurrences are DST-neutral by construction. Isomorphic — the quick-add
// parser runs this in the browser.

import { addDaysIso, isoOrNull, lastDayOfMonth, parseIsoUtc } from './calendar'
import type { TaskRecurrenceDto, TaskRecurrenceFrequency } from '../data/types'

export type TaskRecurrenceRule = {
  freq: TaskRecurrenceFrequency
  weekday: number | null
  dayOfMonth: number | null
}

/** Fill in the anchor a rule needs from the date it was set against: `weekly`
 *  takes the base date's weekday, `monthly` its day of month. */
export function normalizeRecurrence(input: TaskRecurrenceDto, baseIso: string): TaskRecurrenceRule {
  const base = parseIsoUtc(baseIso)
  if (input.freq === 'weekly') {
    return { freq: 'weekly', weekday: input.weekday ?? base.getUTCDay(), dayOfMonth: null }
  }
  if (input.freq === 'monthly') {
    return { freq: 'monthly', weekday: null, dayOfMonth: input.dayOfMonth ?? base.getUTCDate() }
  }
  return { freq: input.freq, weekday: null, dayOfMonth: null }
}

export function firstOccurrenceOnOrAfter(rule: TaskRecurrenceRule, fromIso: string): string {
  switch (rule.freq) {
    case 'daily':
      return fromIso
    case 'weekdays': {
      const dow = parseIsoUtc(fromIso).getUTCDay()
      if (dow === 0) return addDaysIso(fromIso, 1) // Sunday → Monday
      if (dow === 6) return addDaysIso(fromIso, 2) // Saturday → Monday
      return fromIso
    }
    case 'weekly': {
      const dow = parseIsoUtc(fromIso).getUTCDay()
      const target = rule.weekday ?? dow
      return addDaysIso(fromIso, (target - dow + 7) % 7)
    }
    case 'monthly': {
      const from = parseIsoUtc(fromIso)
      const anchor = rule.dayOfMonth ?? from.getUTCDate()
      let year = from.getUTCFullYear()
      let month = from.getUTCMonth()
      let day = Math.min(anchor, lastDayOfMonth(year, month))
      if (day < from.getUTCDate()) {
        month += 1
        if (month > 11) {
          month = 0
          year += 1
        }
        day = Math.min(anchor, lastDayOfMonth(year, month))
      }
      return isoOrNull(year, month + 1, day) as string
    }
  }
}

export function nextOccurrenceAfter(rule: TaskRecurrenceRule, afterIso: string): string {
  return firstOccurrenceOnOrAfter(rule, addDaysIso(afterIso, 1))
}

/**
 * Where a recurring task lands when it is ticked off. Anchored on the later of
 * its own due date and today, so completing a long-overdue daily task moves it
 * to tomorrow rather than replaying every missed day.
 */
export function advanceAfterCompletion(
  rule: TaskRecurrenceRule,
  dueDateIso: string | null,
  todayIso: string,
): string {
  const base = dueDateIso !== null && dueDateIso > todayIso ? dueDateIso : todayIso
  return nextOccurrenceAfter(rule, base)
}

export function toRecurrenceDto(row: {
  recurrenceFreq?: TaskRecurrenceFrequency | null
  recurrenceWeekday?: number | null
  recurrenceDayOfMonth?: number | null
}): TaskRecurrenceDto | null {
  if (!row.recurrenceFreq) return null
  return {
    freq: row.recurrenceFreq,
    weekday: row.recurrenceWeekday ?? null,
    dayOfMonth: row.recurrenceDayOfMonth ?? null,
  }
}
