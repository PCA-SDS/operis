// Vocabulary the one-line quick-add parser recognises. Kept apart from the
// grammar so a new alias or phrase is a data edit, not a regex edit.

import type { TaskPriority } from '../../data/types'
import type { QuickAddWarningCode } from '../../data/types'

export type AliasEntry = {
  value: number
  /** Set when the alias is a tolerated misspelling; the parser reports the
   *  correction rather than silently accepting it. */
  canonical?: string
}

export const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

export const WEEKDAY_SINGULAR: Record<string, AliasEntry> = {
  sunday: { value: 0 },
  sun: { value: 0 },
  monday: { value: 1 },
  mon: { value: 1 },
  tuesday: { value: 2 },
  tue: { value: 2 },
  tues: { value: 2 },
  tusday: { value: 2, canonical: 'Tuesday' },
  tuseday: { value: 2, canonical: 'Tuesday' },
  teusday: { value: 2, canonical: 'Tuesday' },
  wednesday: { value: 3 },
  wed: { value: 3 },
  weds: { value: 3 },
  wednsday: { value: 3, canonical: 'Wednesday' },
  wensday: { value: 3, canonical: 'Wednesday' },
  wedensday: { value: 3, canonical: 'Wednesday' },
  thursday: { value: 4 },
  thu: { value: 4 },
  thur: { value: 4 },
  thurs: { value: 4 },
  thurday: { value: 4, canonical: 'Thursday' },
  thrusday: { value: 4, canonical: 'Thursday' },
  friday: { value: 5 },
  fri: { value: 5 },
  firday: { value: 5, canonical: 'Friday' },
  saturday: { value: 6 },
  sat: { value: 6 },
  saterday: { value: 6, canonical: 'Saturday' },
}

export const WEEKDAY_PLURAL: Record<string, AliasEntry> = {
  sundays: { value: 0 },
  suns: { value: 0 },
  mondays: { value: 1 },
  mons: { value: 1 },
  tuesdays: { value: 2 },
  wednesdays: { value: 3 },
  thursdays: { value: 4 },
  fridays: { value: 5 },
  fris: { value: 5 },
  saturdays: { value: 6 },
  sats: { value: 6 },
}

export const MONTHS: Record<string, AliasEntry> = {
  january: { value: 1 },
  jan: { value: 1 },
  february: { value: 2 },
  feb: { value: 2 },
  febuary: { value: 2, canonical: 'February' },
  march: { value: 3 },
  mar: { value: 3 },
  april: { value: 4 },
  apr: { value: 4 },
  may: { value: 5 },
  june: { value: 6 },
  jun: { value: 6 },
  july: { value: 7 },
  jul: { value: 7 },
  august: { value: 8 },
  aug: { value: 8 },
  september: { value: 9 },
  sept: { value: 9 },
  sep: { value: 9 },
  october: { value: 10 },
  oct: { value: 10 },
  november: { value: 11 },
  nov: { value: 11 },
  december: { value: 12 },
  dec: { value: 12 },
}

/** "today"-meaning words. "tonight" resolves to today's date with no invented
 *  time — there is no configured default-evening hour. */
export const TODAY_WORDS: Record<string, { canonical?: string }> = {
  today: {},
  tonight: {},
}

/** "tomorrow"-meaning words: abbreviations plus a typo allowlist. Deliberately
 *  NOT "tom" — it is a common name ("Email Tom"). */
export const TOMORROW_WORDS: Record<string, { canonical?: string }> = {
  tomorrow: {},
  tmr: {},
  tmrw: {},
  tomorow: { canonical: 'tomorrow' },
  tommorow: { canonical: 'tomorrow' },
  tommorrow: { canonical: 'tomorrow' },
}

/** Small-number words for "in three days" style offsets. */
export const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}

// ---------------------------------------------------------------------
// Recurrence phrases — all resolve to the storable rule model
// (daily | weekdays | weekly[+weekday] | monthly[+dayOfMonth]).
// ---------------------------------------------------------------------

export const DAILY_PHRASES = [
  'every day',
  'every single day',
  'every 24 hours',
  'each day',
  'once a day',
  'daily',
] as const

export const WEEKDAYS_PHRASES = [
  'every weekday',
  'every weekdays',
  'each weekday',
  'on weekdays',
  'weekdays',
  'every workday',
  'on workdays',
  'workdays',
  'every business day',
  'on business days',
  'monday to friday',
  'monday through friday',
  'mon to fri',
  'mon through fri',
  'mon-fri',
] as const

export const WEEKLY_PHRASES = ['every week', 'each week', 'once a week', 'weekly'] as const

export const MONTHLY_PHRASES = ['every month', 'each month', 'once a month', 'monthly'] as const

/** Lead-ins that combine with a weekday: "weekly on Tuesday", "once a week on
 *  Tue", "every week on Tuesday". */
export const WEEKLY_ON_LEADINS = ['every week on', 'once a week on', 'weekly on'] as const

// ---------------------------------------------------------------------
// Recognised-but-unsupported recurrence shapes. The parser warns and leaves the
// phrase in the title (nothing is guessed, nothing is lost); storing these
// needs a schema extension (interval / weekday-set / yearly columns), which is
// a product decision rather than a parser one.
// ---------------------------------------------------------------------

export type UnsupportedRecurrenceRule = {
  /** Regex source (case-insensitive, applied with the parser's boundaries). */
  source: string
  warning: QuickAddWarningCode
}

export const UNSUPPORTED_RECURRENCE: UnsupportedRecurrenceRule[] = [
  {
    // "every 24 hours" is carved out — it is plain daily (DAILY_PHRASES).
    source:
      '(?:every|each)\\s+(?!24\\s+hours)(?:other|2nd|second|3rd|third|4th|fourth|first|1st|last|\\d+)\\s+\\S+',
    warning: 'intervalRepeat',
  },
  {
    source: '(?:every\\s+year|each\\s+year|once\\s+a\\s+year|yearly|annually)',
    warning: 'yearlyRepeat',
  },
  {
    source: '(?:every\\s+quarter|quarterly)',
    warning: 'quarterlyRepeat',
  },
  {
    source: '(?:every\\s+weekend|on\\s+weekends|weekends)',
    warning: 'weekendRepeat',
  },
]

/** Priority tokens (Todoist-style, p1 = most urgent) → TaskPriority values. */
export const PRIORITY_TOKENS: Record<string, TaskPriority> = {
  p1: 'urgent',
  p2: 'high',
  p3: 'medium',
  p4: 'low',
}
