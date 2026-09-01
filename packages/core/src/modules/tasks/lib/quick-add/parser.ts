// One-line quick-add grammar: "Plan lunch with @amir by tomorrow 3pm +design
// #Ops p1". Pure and isomorphic — the composer runs it for the live preview and
// the parse endpoint runs it again for the authoritative interpretation, so the
// two can never drift.
//
// Recognised spans are removed from the title and reported with their offsets
// so the composer can highlight them in place. Anything the parser is not sure
// about is left in the title and reported as a warning: nothing is guessed.

import {
  DAILY_PHRASES,
  MONTHLY_PHRASES,
  MONTHS,
  NUMBER_WORDS,
  PRIORITY_TOKENS,
  TODAY_WORDS,
  TOMORROW_WORDS,
  UNSUPPORTED_RECURRENCE,
  WEEKDAYS_PHRASES,
  WEEKDAY_LABELS,
  WEEKDAY_PLURAL,
  WEEKDAY_SINGULAR,
  WEEKLY_ON_LEADINS,
  WEEKLY_PHRASES,
  type AliasEntry,
  DUE_LEADINS,
} from './vocabulary'
import { addDaysIso, addMonthsClamped, isoOrNull, lastDayOfMonth, parseIsoUtc } from '../calendar'
import { firstOccurrenceOnOrAfter } from '../recurrence'
import type {
  QuickAddRecognizedTokenDto,
  QuickAddWarningCode,
  QuickAddWarningDto,
  TaskPriority,
  TaskRecurrenceDto,
} from '../../data/types'

export type ParsedQuickAdd = {
  title: string
  projectQuery: string | null
  assigneeQuery: string | null
  labelQueries: string[]
  dueDate: string | null
  dueTime: string | null
  recurrence: TaskRecurrenceDto | null
  priority: TaskPriority | null
  recognizedTokens: QuickAddRecognizedTokenDto[]
  warnings: QuickAddWarningDto[]
}

const B_START = '(^|[\\s,;:(])'
const B_END = '(?=$|[\\s,.;:!?)])'

/**
 * An optional deadline lead-in, consumed together with the date or time that
 * follows it. Non-capturing on purpose: every pattern below indexes its groups
 * positionally, so introducing a capture here would shift them all by one.
 */
const LEADIN = `(?:(?:${phraseAlt(DUE_LEADINS)})\\s+)?`
/** Private-use codepoint standing in for text the parser must skip over. */
const MASK = '\uE000'

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function phraseAlt(phrases: readonly string[]): string {
  return [...phrases]
    .sort((a, b) => b.length - a.length)
    .map((phrase) => escapeRe(phrase).replace(/ /g, '\\s+'))
    .join('|')
}

function aliasAlt(dict: Record<string, unknown>): string {
  return Object.keys(dict)
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|')
}

const WD_SINGULAR_ALT = aliasAlt(WEEKDAY_SINGULAR)
const WD_PLURAL_ALT = aliasAlt(WEEKDAY_PLURAL)
const WD_ANY_ALT = `${WD_PLURAL_ALT}|${WD_SINGULAR_ALT}`
const MONTH_ALT = aliasAlt(MONTHS)
const NUMBER_ALT = `\\d{1,3}|${aliasAlt(NUMBER_WORDS)}`
const PROJECT_REGEX = /(^|\s)#(?:"([^"]+)"|([\p{L}\p{N}_-]+))/u
const ASSIGNEE_REGEX = /(^|\s)@(?:"([^"]+)"|([\p{L}\p{N}_-]+))/u
const LABEL_REGEX = /(^|\s)\+(?:"([^"]+)"|([\p{L}\p{N}_-]+))/u
const MAX_LABEL_TOKENS = 30

function nextMonthDateOnOrAfter(todayIso: string, month: number, day: number): string | null {
  const startYear = Number(todayIso.slice(0, 4))
  for (let year = startYear; year <= startYear + 8; year++) {
    const iso = isoOrNull(year, month, day)
    if (iso !== null && iso >= todayIso) return iso
  }
  return null
}

function nextDayOfMonthOnOrAfter(todayIso: string, day: number): string {
  let year = Number(todayIso.slice(0, 4))
  let month = Number(todayIso.slice(5, 7))
  for (let i = 0; i < 24; i++) {
    const iso = isoOrNull(year, month, day)
    if (iso !== null && iso >= todayIso) return iso
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return todayIso
}

function lastDayOfCurrentMonth(todayIso: string): string {
  const year = Number(todayIso.slice(0, 4))
  const month = Number(todayIso.slice(5, 7))
  return isoOrNull(year, month, lastDayOfMonth(year, month - 1)) as string
}

function firstOfNextMonth(todayIso: string): string {
  const year = Number(todayIso.slice(0, 4))
  const month = Number(todayIso.slice(5, 7))
  return month === 12 ? (isoOrNull(year + 1, 1, 1) as string) : (isoOrNull(year, month + 1, 1) as string)
}

function weekdayOnOrAfter(fromIso: string, weekday: number): string {
  return firstOccurrenceOnOrAfter({ freq: 'weekly', weekday, dayOfMonth: null }, fromIso)
}

export function parseQuickAdd(text: string, todayIso: string): ParsedQuickAdd {
  const state = new ParseState(text)

  state.maskQuotedLiterals()
  const projectQuery = extractProject(state)
  const assigneeQuery = extractAssignee(state)
  const labelQueries = extractLabels(state)
  const priority = extractPriority(state)
  maskUnsupportedRecurrence(state)
  const recurrence = extractRecurrence(state)
  const dueTime = extractTime(state)
  let dueDate = extractDate(state, todayIso)

  if (recurrence) {
    const base = dueDate ?? todayIso
    dueDate = firstOccurrenceOnOrAfter(normalizeParsedRecurrence(recurrence, base), base)
  } else if (dueTime !== null && dueDate === null) {
    dueDate = todayIso
  }

  const title = state.cleanTitle()
  if (title.length === 0) state.warn('noTitle')

  return {
    title,
    projectQuery: projectQuery && projectQuery.length > 0 ? projectQuery : null,
    assigneeQuery: assigneeQuery && assigneeQuery.length > 0 ? assigneeQuery : null,
    labelQueries,
    dueDate,
    dueTime,
    recurrence,
    priority,
    recognizedTokens: state.tokens,
    warnings: state.warnings,
  }
}

function normalizeParsedRecurrence(rec: TaskRecurrenceDto, baseIso: string) {
  return {
    freq: rec.freq,
    weekday: rec.freq === 'weekly' ? (rec.weekday ?? parseIsoUtc(baseIso).getUTCDay()) : null,
    dayOfMonth: rec.freq === 'monthly' ? (rec.dayOfMonth ?? Number(baseIso.slice(8, 10))) : null,
  }
}

/**
 * Two parallel strings: `remaining` is what will become the title, `scan` is
 * the same text with already-consumed and masked spans blanked out so later
 * rules cannot re-match them. `origIndex` maps a position in either back to the
 * caller's original string, which is what the composer highlights against.
 */
class ParseState {
  remaining: string
  scan: string
  readonly tokens: QuickAddRecognizedTokenDto[] = []
  readonly warnings: QuickAddWarningDto[] = []
  private origIndex: number[]

  constructor(text: string) {
    this.remaining = text
    this.scan = text
    this.origIndex = Array.from({ length: text.length }, (_, i) => i)
  }

  warn(code: QuickAddWarningCode, params?: Record<string, string | number>): void {
    this.warnings.push(params ? { code, params } : { code })
  }

  match(re: RegExp): RegExpMatchArray | null {
    return this.scan.match(re)
  }

  consume(
    match: RegExpMatchArray,
    type: QuickAddRecognizedTokenDto['type'],
    normalized?: string,
    corrected?: string,
  ): void {
    const index = match.index ?? 0
    const leading = match[1] ?? ''
    const from = index + leading.length
    const to = index + match[0].length
    const slice = this.remaining.slice(from, to)
    const original = slice.trim()
    const lead = slice.length - slice.trimStart().length
    const trail = slice.length - slice.trimEnd().length
    const token: QuickAddRecognizedTokenDto = {
      text: original,
      type,
      start: this.origIndex[from + lead]!,
      end: this.origIndex[to - 1 - trail]! + 1,
    }
    if (normalized !== undefined) token.normalized = normalized
    if (corrected !== undefined) {
      token.corrected = corrected
      this.warn('typoCorrected', { text: original, corrected })
    }
    this.tokens.push(token)
    this.remaining = this.remaining.slice(0, from) + this.remaining.slice(to)
    this.scan = this.scan.slice(0, from) + this.scan.slice(to)
    this.origIndex = [...this.origIndex.slice(0, from), ...this.origIndex.slice(to)]
  }

  maskSpan(index: number, length: number): void {
    this.scan = this.scan.slice(0, index) + MASK.repeat(length) + this.scan.slice(index + length)
  }

  /** A quoted literal is the user asking for that text verbatim, so no
   *  scheduling rule may claim a span inside it. `#"…"`, `@"…"` and `+"…"`
   *  are exempt — those quotes belong to the reference token. */
  maskQuotedLiterals(): void {
    const re = /"[^"\n]{1,300}"/g
    for (const match of this.scan.matchAll(re)) {
      const index = match.index ?? 0
      const prev = index > 0 ? this.scan[index - 1] : ''
      if (prev === '#' || prev === '@' || prev === '+') continue
      this.maskSpan(index, match[0].length)
    }
  }

  cleanTitle(): string {
    return this.remaining
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/^[\s,.;:]+/, '')
      .replace(/[\s,;]+$/, '')
      .trim()
  }
}

function extractProject(state: ParseState): string | null {
  const match = state.match(PROJECT_REGEX)
  if (!match) return null
  const query = (match[2] ?? match[3] ?? '').trim()
  state.consume(match, 'project', query)
  if (PROJECT_REGEX.test(state.scan)) state.warn('multipleProjects')
  return query
}

function extractAssignee(state: ParseState): string | null {
  const match = state.match(ASSIGNEE_REGEX)
  if (!match) return null
  const query = (match[2] ?? match[3] ?? '').trim()
  state.consume(match, 'assignee', query)
  if (ASSIGNEE_REGEX.test(state.scan)) state.warn('multipleAssignees')
  return query
}

function extractLabels(state: ParseState): string[] {
  const queries: string[] = []
  for (let i = 0; i < MAX_LABEL_TOKENS; i++) {
    const match = state.match(LABEL_REGEX)
    if (!match) break
    const query = (match[2] ?? match[3] ?? '').trim()
    state.consume(match, 'label', query)
    if (query.length > 0 && !queries.some((existing) => existing.toLowerCase() === query.toLowerCase())) {
      queries.push(query)
    }
  }
  return queries
}

const PRIORITY_REGEX = new RegExp(`${B_START}(${aliasAlt(PRIORITY_TOKENS)})${B_END}`, 'i')

function extractPriority(state: ParseState): TaskPriority | null {
  const match = state.match(PRIORITY_REGEX)
  if (!match) return null
  const value = PRIORITY_TOKENS[match[2]!.toLowerCase()]!
  state.consume(match, 'priority', value)
  return value
}

const WD_LIST_ITEM = `(?:${WD_ANY_ALT})\\.?`
const MULTI_WEEKDAY_SOURCES = [
  `(?:every|each)\\s+${WD_LIST_ITEM}(?:\\s*,\\s*${WD_LIST_ITEM})*(?:\\s*,?\\s*(?:and|&)\\s+${WD_LIST_ITEM})`,
  `(?:${WD_PLURAL_ALT})(?:\\s*,\\s*(?:${WD_PLURAL_ALT}))*\\s*,?\\s*(?:and|&)\\s+(?:${WD_PLURAL_ALT})`,
] as const
const EXCEPT_SOURCE = `(?:every|each)\\s+\\S+(?:\\s+\\S+)?\\s+except\\s+\\S+`

const UNSUPPORTED_RULES: { re: RegExp; warning: QuickAddWarningCode }[] = [
  ...MULTI_WEEKDAY_SOURCES.map((source) => ({
    re: new RegExp(`${B_START}(?:${source})${B_END}`, 'i'),
    warning: 'multiWeekdayRepeat' as const,
  })),
  {
    re: new RegExp(`${B_START}(?:${EXCEPT_SOURCE})${B_END}`, 'i'),
    warning: 'repeatException' as const,
  },
  ...UNSUPPORTED_RECURRENCE.map((rule) => ({
    re: new RegExp(`${B_START}(?:${rule.source})${B_END}`, 'i'),
    warning: rule.warning,
  })),
]

function maskUnsupportedRecurrence(state: ParseState): void {
  for (const rule of UNSUPPORTED_RULES) {
    const match = state.match(rule.re)
    if (!match) continue
    const index = (match.index ?? 0) + (match[1] ?? '').length
    state.maskSpan(index, match[0].length - (match[1] ?? '').length)
    state.warn(rule.warning)
  }
}

const MONTHLY_ON_DAY_REGEX = new RegExp(
  `${B_START}(?:` +
    `(?:every|each)\\s+month\\s+on(?:\\s+the)?\\s+(\\d{1,2})(?:st|nd|rd|th)?` +
    `|monthly\\s+on(?:\\s+the)?\\s+(\\d{1,2})(?:st|nd|rd|th)?` +
    `|(?:on\\s+)?the\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+of\\s+(?:every|each)\\s+month` +
    `|every\\s+(\\d{1,2})(?:st|nd|rd|th)\\s+of\\s+the\\s+month` +
    `)${B_END}`,
  'i',
)
const WEEKDAYS_FREQ_REGEX = new RegExp(`${B_START}(${phraseAlt(WEEKDAYS_PHRASES)})${B_END}`, 'i')
const EVERY_WEEKDAY_REGEX = new RegExp(`${B_START}(?:every|each)\\s+((?:${WD_ANY_ALT})\\.?)${B_END}`, 'i')
const WEEKLY_ON_WEEKDAY_REGEX = new RegExp(
  `${B_START}(?:${phraseAlt(WEEKLY_ON_LEADINS)})\\s+((?:${WD_SINGULAR_ALT})\\.?)${B_END}`,
  'i',
)
const BARE_PLURAL_WEEKDAY_REGEX = new RegExp(`${B_START}((?:${WD_PLURAL_ALT})\\.?)${B_END}`, 'i')
const DAILY_REGEX = new RegExp(`${B_START}(?:${phraseAlt(DAILY_PHRASES)})${B_END}`, 'i')
const WEEKLY_REGEX = new RegExp(`${B_START}(?:${phraseAlt(WEEKLY_PHRASES)})${B_END}`, 'i')
const MONTHLY_REGEX = new RegExp(`${B_START}(?:${phraseAlt(MONTHLY_PHRASES)})${B_END}`, 'i')
const END_CONDITION_REGEX = new RegExp(
  `${B_START}(?:until\\s+\\S+|starting\\s+\\S+|for\\s+\\d+\\s+(?:times|occurrences))`,
  'i',
)

function lookupWeekday(raw: string): { value: number; corrected?: string } | null {
  const key = raw.toLowerCase().replace(/\.$/, '')
  const entry: AliasEntry | undefined = WEEKDAY_PLURAL[key] ?? WEEKDAY_SINGULAR[key]
  if (!entry) return null
  return { value: entry.value, corrected: entry.canonical }
}

function extractRecurrence(state: ParseState): TaskRecurrenceDto | null {
  const found = extractRecurrenceInner(state)
  if (found && state.match(END_CONDITION_REGEX)) state.warn('repeatEndCondition')
  return found
}

function extractRecurrenceInner(state: ParseState): TaskRecurrenceDto | null {
  const monthlyOnDay = state.match(MONTHLY_ON_DAY_REGEX)
  if (monthlyOnDay) {
    const day = Number(monthlyOnDay[2] ?? monthlyOnDay[3] ?? monthlyOnDay[4] ?? monthlyOnDay[5])
    if (day < 1 || day > 31) {
      state.warn('invalidDayOfMonth', { day })
      const index = (monthlyOnDay.index ?? 0) + (monthlyOnDay[1] ?? '').length
      state.maskSpan(index, monthlyOnDay[0].length - (monthlyOnDay[1] ?? '').length)
      return null
    }
    state.consume(monthlyOnDay, 'recurrence', `monthly:day-${day}`)
    return { freq: 'monthly', dayOfMonth: day }
  }

  const weekdaysFreq = state.match(WEEKDAYS_FREQ_REGEX)
  if (weekdaysFreq) {
    state.consume(weekdaysFreq, 'recurrence', 'weekdays')
    return { freq: 'weekdays' }
  }

  const everyWeekday = state.match(EVERY_WEEKDAY_REGEX) ?? state.match(WEEKLY_ON_WEEKDAY_REGEX)
  if (everyWeekday) {
    const weekday = lookupWeekday(everyWeekday[2]!)
    if (weekday) {
      state.consume(
        everyWeekday,
        'recurrence',
        `weekly:${WEEKDAY_LABELS[weekday.value]!.toLowerCase()}`,
        weekday.corrected,
      )
      return { freq: 'weekly', weekday: weekday.value }
    }
  }

  const barePlural = state.match(BARE_PLURAL_WEEKDAY_REGEX)
  if (barePlural) {
    const weekday = lookupWeekday(barePlural[2]!)
    if (weekday) {
      state.consume(
        barePlural,
        'recurrence',
        `weekly:${WEEKDAY_LABELS[weekday.value]!.toLowerCase()}`,
        weekday.corrected,
      )
      return { freq: 'weekly', weekday: weekday.value }
    }
  }

  const daily = state.match(DAILY_REGEX)
  if (daily) {
    state.consume(daily, 'recurrence', 'daily')
    return { freq: 'daily' }
  }
  const weekly = state.match(WEEKLY_REGEX)
  if (weekly) {
    state.consume(weekly, 'recurrence', 'weekly')
    return { freq: 'weekly' }
  }
  const monthly = state.match(MONTHLY_REGEX)
  if (monthly) {
    state.consume(monthly, 'recurrence', 'monthly')
    return { freq: 'monthly' }
  }
  return null
}

const NAMED_TIMES: Record<string, string> = {
  noon: '12:00',
  midday: '12:00',
  midnight: '00:00',
}
const AT_TIME_REGEX =
  /(^|\s)at\s+(?:(noon|midday|midnight)|(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?)(?=$|[\s,.;:!?)])/i
const BARE_MERIDIEM_REGEX = new RegExp(`(^|[\\s,;:(])${LEADIN}(\\d{1,2})(?:[:.](\\d{2}))?\\s?(am|pm)(?=$|[\\s,.;:!?)])`, 'i')
const BARE_24H_REGEX = new RegExp(`(^|[\\s,;:(])${LEADIN}([01]?\\d|2[0-3]):([0-5]\\d)(?=$|[\\s,.;!?)])`)
const BARE_NAMED_TIME_REGEX = new RegExp(`${B_START}${LEADIN}(noon|midday|midnight)${B_END}`, 'i')

function extractTime(state: ParseState): string | null {
  const at = state.match(AT_TIME_REGEX)
  if (at) {
    if (at[2] !== undefined) {
      const hhmm = NAMED_TIMES[at[2].toLowerCase()]!
      state.consume(at, 'time', hhmm)
      return hhmm
    }
    const rawHour = Number(at[3])
    const minutes = at[4] !== undefined ? Number(at[4]) : 0
    const meridiem = at[5]?.toLowerCase() ?? null
    if (at[4] === undefined && meridiem === null) {
      // "at 3" could be 3am or 3pm; asking is better than picking one.
      state.warn('timeNeedsMinutes', { text: at[0].trim() })
      return null
    }
    const hour = resolveHour(rawHour, meridiem)
    if (hour === null || minutes > 59) {
      state.warn('invalidTime', { text: at[0].trim() })
      state.consume(at, 'time')
      return null
    }
    const hhmm = `${pad2(hour)}:${pad2(minutes)}`
    state.consume(at, 'time', hhmm)
    return hhmm
  }

  const bare = state.match(BARE_MERIDIEM_REGEX)
  if (bare) {
    const hour = resolveHour(Number(bare[2]), bare[4]!.toLowerCase())
    const minutes = bare[3] !== undefined ? Number(bare[3]) : 0
    if (hour !== null && minutes <= 59) {
      const hhmm = `${pad2(hour)}:${pad2(minutes)}`
      state.consume(bare, 'time', hhmm)
      return hhmm
    }
    state.warn('invalidTime', { text: bare[0].trim() })
    state.consume(bare, 'time')
    return null
  }

  const bare24 = state.match(BARE_24H_REGEX)
  if (bare24) {
    const hhmm = `${pad2(Number(bare24[2]))}:${bare24[3]}`
    state.consume(bare24, 'time', hhmm)
    return hhmm
  }

  const named = state.match(BARE_NAMED_TIME_REGEX)
  if (named) {
    const hhmm = NAMED_TIMES[named[2]!.toLowerCase()]!
    state.consume(named, 'time', hhmm)
    return hhmm
  }
  return null
}

function resolveHour(raw: number, meridiem: string | null): number | null {
  if (meridiem === null) return raw <= 23 ? raw : null
  if (raw < 1 || raw > 12) return null
  if (meridiem === 'am') return raw === 12 ? 0 : raw
  return raw === 12 ? 12 : raw + 12
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

const ISO_DATE_TOKEN_REGEX = new RegExp(`${B_START}${LEADIN}(\\d{4})-(\\d{2})-(\\d{2})${B_END}`)
const MONTH_FIRST_REGEX = new RegExp(
  `${B_START}${LEADIN}(${MONTH_ALT})\\.?\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${B_END}`,
  'i',
)
const DAY_FIRST_REGEX = new RegExp(
  `${B_START}${LEADIN}(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})\\.?(?:,?\\s+(\\d{4}))?${B_END}`,
  'i',
)
const SLASH_DATE_REGEX = new RegExp(`${B_START}${LEADIN}(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?${B_END}`)
const DAY_OF_MONTH_REGEX = new RegExp(`${B_START}${LEADIN}the\\s+(\\d{1,2})(st|nd|rd|th)${B_END}`, 'i')
const TODAY_REGEX = new RegExp(`${B_START}${LEADIN}(${aliasAlt(TODAY_WORDS)})${B_END}`, 'i')
const TOMORROW_REGEX = new RegExp(`${B_START}${LEADIN}(${aliasAlt(TOMORROW_WORDS)})${B_END}`, 'i')
const DAY_AFTER_TOMORROW_REGEX = new RegExp(`${B_START}${LEADIN}(?:the\\s+)?day\\s+after\\s+tomorrow${B_END}`, 'i')
const IN_OFFSET_REGEX = new RegExp(`${B_START}in\\s+(${NUMBER_ALT})\\s+(day|week|month)s?${B_END}`, 'i')
const FROM_NOW_REGEX = new RegExp(
  `${B_START}(${NUMBER_ALT})\\s+(day|week|month)s?\\s+from\\s+(?:now|today)${B_END}`,
  'i',
)
const NEXT_WEEK_REGEX = new RegExp(`${B_START}${LEADIN}next\\s+week${B_END}`, 'i')
const NEXT_MONTH_REGEX = new RegExp(`${B_START}${LEADIN}next\\s+month${B_END}`, 'i')
const END_OF_WEEK_REGEX = new RegExp(`${B_START}${LEADIN}(?:end\\s+of\\s+(?:the\\s+)?week|eow)${B_END}`, 'i')
const END_OF_MONTH_REGEX = new RegExp(`${B_START}${LEADIN}(?:end\\s+of\\s+(?:the\\s+)?month|eom)${B_END}`, 'i')
const START_OF_NEXT_MONTH_REGEX = new RegExp(`${B_START}${LEADIN}start\\s+of\\s+next\\s+month${B_END}`, 'i')
const THIS_WEEKEND_REGEX = new RegExp(`${B_START}${LEADIN}this\\s+weekend${B_END}`, 'i')
const NEXT_WEEKEND_REGEX = new RegExp(`${B_START}${LEADIN}next\\s+weekend${B_END}`, 'i')
const NEXT_WEEKDAY_REGEX = new RegExp(`${B_START}${LEADIN}next\\s+((?:${WD_SINGULAR_ALT})\\.?)${B_END}`, 'i')
const THIS_WEEKDAY_REGEX = new RegExp(`${B_START}${LEADIN}this\\s+((?:${WD_SINGULAR_ALT})\\.?)${B_END}`, 'i')
const BARE_WEEKDAY_REGEX = new RegExp(`${B_START}${LEADIN}((?:${WD_SINGULAR_ALT})\\.?)${B_END}`, 'i')

function extractDate(state: ParseState, todayIso: string): string | null {
  return extractAbsoluteDate(state, todayIso) ?? extractRelativeDate(state, todayIso)
}

function extractAbsoluteDate(state: ParseState, todayIso: string): string | null {
  const iso = state.match(ISO_DATE_TOKEN_REGEX)
  if (iso) {
    const date = isoOrNull(Number(iso[2]), Number(iso[3]), Number(iso[4]))
    if (date === null) {
      state.warn('invalidDate', { text: iso[0].trim() })
      return null
    }
    state.consume(iso, 'date', date)
    return date
  }

  const monthDay =
    parseMonthName(state, state.match(MONTH_FIRST_REGEX), 2, 3, 4, todayIso) ??
    parseMonthName(state, state.match(DAY_FIRST_REGEX), 3, 2, 4, todayIso)
  if (monthDay !== null) return monthDay

  const slash = state.match(SLASH_DATE_REGEX)
  if (slash) return parseSlashDate(state, slash, todayIso)

  const dayOfMonth = state.match(DAY_OF_MONTH_REGEX)
  if (dayOfMonth) {
    const day = Number(dayOfMonth[2])
    if (day < 1 || day > 31) {
      state.warn('invalidDay', { text: dayOfMonth[0].trim() })
      return null
    }
    const date = nextDayOfMonthOnOrAfter(todayIso, day)
    state.consume(dayOfMonth, 'date', date)
    return date
  }
  return null
}

function parseMonthName(
  state: ParseState,
  match: RegExpMatchArray | null,
  monthGroup: number,
  dayGroup: number,
  yearGroup: number,
  todayIso: string,
): string | null {
  if (!match) return null
  const monthEntry = MONTHS[match[monthGroup]!.toLowerCase().replace(/\.$/, '')]
  if (!monthEntry) return null
  const day = Number(match[dayGroup])
  const year = match[yearGroup] !== undefined ? Number(match[yearGroup]) : null

  const date =
    year !== null ? isoOrNull(year, monthEntry.value, day) : nextMonthDateOnOrAfter(todayIso, monthEntry.value, day)
  if (date === null) {
    state.warn('invalidDate', { text: match[0].trim() })
    return null
  }
  state.consume(match, 'date', date, monthEntry.canonical)
  return date
}

function parseSlashDate(state: ParseState, match: RegExpMatchArray, todayIso: string): string | null {
  const a = Number(match[2])
  const b = Number(match[3])
  const rawYear = match[4]
  const year = rawYear === undefined ? null : rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)

  const resolve = (month: number, day: number): string | null =>
    year !== null ? isoOrNull(year, month, day) : nextMonthDateOnOrAfter(todayIso, month, day)

  const dayFirst = resolve(b, a)
  const monthFirst = resolve(a, b)
  if (dayFirst !== null && monthFirst !== null && dayFirst !== monthFirst) {
    // 3/4 is March 4th or April 3rd depending on where you live. Refuse.
    state.warn('ambiguousDate', { text: match[0].trim(), suggestion: `${monthLabel(a)} ${b}` })
    return null
  }
  const date = dayFirst ?? monthFirst
  if (date === null) {
    state.warn('invalidDate', { text: match[0].trim() })
    return null
  }
  state.consume(match, 'date', date)
  return date
}

function monthLabel(month: number): string {
  const entry = Object.entries(MONTHS).find(([name, meta]) => meta.value === month && name.length > 4)
  const name = entry?.[0] ?? 'April'
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function extractRelativeDate(state: ParseState, todayIso: string): string | null {
  const dayAfter = state.match(DAY_AFTER_TOMORROW_REGEX)
  if (dayAfter) {
    const date = addDaysIso(todayIso, 2)
    state.consume(dayAfter, 'date', date)
    return date
  }

  const today = state.match(TODAY_REGEX)
  if (today) {
    const word = today[2]!.toLowerCase()
    state.consume(today, 'date', todayIso, TODAY_WORDS[word]?.canonical)
    return todayIso
  }

  const tomorrow = state.match(TOMORROW_REGEX)
  if (tomorrow) {
    const word = tomorrow[2]!.toLowerCase()
    const date = addDaysIso(todayIso, 1)
    state.consume(tomorrow, 'date', date, TOMORROW_WORDS[word]?.canonical)
    return date
  }

  const offset = state.match(IN_OFFSET_REGEX) ?? state.match(FROM_NOW_REGEX)
  if (offset) {
    const count = /^\d+$/.test(offset[2]!) ? Number(offset[2]) : NUMBER_WORDS[offset[2]!.toLowerCase()]!
    const unit = offset[3]!.toLowerCase()
    const date =
      unit === 'day'
        ? addDaysIso(todayIso, count)
        : unit === 'week'
          ? addDaysIso(todayIso, count * 7)
          : addMonthsClamped(todayIso, count)
    state.consume(offset, 'date', date)
    return date
  }

  const namedSpans: [RegExp, (today: string) => string][] = [
    [START_OF_NEXT_MONTH_REGEX, firstOfNextMonth],
    [NEXT_WEEK_REGEX, (today) => weekdayOnOrAfter(addDaysIso(today, 1), 1)],
    [NEXT_MONTH_REGEX, (today) => addMonthsClamped(today, 1)],
    [END_OF_WEEK_REGEX, (today) => weekdayOnOrAfter(today, 5)],
    [END_OF_MONTH_REGEX, lastDayOfCurrentMonth],
    [THIS_WEEKEND_REGEX, (today) => weekdayOnOrAfter(today, 6)],
    [NEXT_WEEKEND_REGEX, (today) => addDaysIso(weekdayOnOrAfter(today, 6), 7)],
  ]
  for (const [re, resolveDate] of namedSpans) {
    const match = state.match(re)
    if (match) {
      const date = resolveDate(todayIso)
      state.consume(match, 'date', date)
      return date
    }
  }

  const nextWeekday = state.match(NEXT_WEEKDAY_REGEX)
  if (nextWeekday) {
    const weekday = lookupWeekday(nextWeekday[2]!)
    if (weekday) {
      const date = weekdayOnOrAfter(addDaysIso(todayIso, 1), weekday.value)
      state.consume(nextWeekday, 'date', date, weekday.corrected)
      return date
    }
  }
  const thisWeekday = state.match(THIS_WEEKDAY_REGEX)
  if (thisWeekday) {
    const weekday = lookupWeekday(thisWeekday[2]!)
    if (weekday) {
      const date = weekdayOnOrAfter(todayIso, weekday.value)
      state.consume(thisWeekday, 'date', date, weekday.corrected)
      return date
    }
  }
  const bareWeekday = state.match(BARE_WEEKDAY_REGEX)
  if (bareWeekday) {
    const weekday = lookupWeekday(bareWeekday[2]!)
    if (weekday) {
      const date = weekdayOnOrAfter(todayIso, weekday.value)
      state.consume(bareWeekday, 'date', date, weekday.corrected)
      return date
    }
  }
  return null
}
