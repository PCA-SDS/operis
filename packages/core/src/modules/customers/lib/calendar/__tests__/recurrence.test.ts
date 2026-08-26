import { expandOccurrences } from '../recurrence'
import { makeCalendarItem, makePayload } from './fixtures'
import type { CalendarItem, CalendarRange } from '../../../components/calendar/types'

function makeRecurringItem(rule: string | null, options: { recurrenceEnd?: string | null } = {}): CalendarItem {
  const start = new Date(2026, 5, 1, 10, 0, 0)
  const end = new Date(2026, 5, 1, 11, 0, 0)
  return makeCalendarItem({
    id: 'series-base',
    start,
    end,
    raw: makePayload({
      id: 'series-base',
      recurrenceRule: rule,
      recurrenceEnd: options.recurrenceEnd ?? null,
    }),
  })
}

function windowOf(from: Date, to: Date): CalendarRange {
  return { from, to }
}

const twoWeekWindow = windowOf(new Date(2026, 5, 1, 0, 0, 0), new Date(2026, 5, 14, 23, 59, 59))

describe('expandOccurrences', () => {
  it('returns the item unchanged when no recurrence rule is set', () => {
    const item = makeRecurringItem(null)
    const occurrences = expandOccurrences(item, twoWeekWindow)
    expect(occurrences).toHaveLength(1)
    expect(occurrences[0]).toBe(item)
  })

  it('degrades an unparseable rule to the single stored event', () => {
    const malformed = makeRecurringItem('FREQ=WEEKLY;BYDAY=XX')
    expect(expandOccurrences(malformed, twoWeekWindow)).toEqual([malformed])

    const unknownComponent = makeRecurringItem('FREQ=DAILY;BYSETPOS=2')
    expect(expandOccurrences(unknownComponent, twoWeekWindow)).toEqual([unknownComponent])

    const badFrequency = makeRecurringItem('FREQ=HOURLY')
    expect(expandOccurrences(badFrequency, twoWeekWindow)).toEqual([badFrequency])
  })

  it('expands FREQ=DAILY with COUNT and suffixes occurrence ids', () => {
    const item = makeRecurringItem('FREQ=DAILY;COUNT=3')
    const occurrences = expandOccurrences(item, twoWeekWindow)
    expect(occurrences.map((occurrence) => occurrence.id)).toEqual([
      'series-base:0',
      'series-base:1',
      'series-base:2',
    ])
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 2, 3])
    for (const occurrence of occurrences) {
      expect(occurrence.isRecurringOccurrence).toBe(true)
      expect(occurrence.raw.id).toBe('series-base')
      expect(occurrence.start.getHours()).toBe(10)
      expect(occurrence.end.getTime() - occurrence.start.getTime()).toBe(60 * 60 * 1000)
    }
  })

  it('expands FREQ=WEEKLY with a BYDAY list', () => {
    const item = makeRecurringItem('FREQ=WEEKLY;BYDAY=MO,WE,FR')
    const oneWeekWindow = windowOf(new Date(2026, 5, 1, 0, 0, 0), new Date(2026, 5, 7, 23, 59, 59))
    const occurrences = expandOccurrences(item, oneWeekWindow)
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 3, 5])
    expect(occurrences.map((occurrence) => occurrence.start.getDay())).toEqual([1, 3, 5])
  })

  it('stops weekly expansion at UNTIL', () => {
    const item = makeRecurringItem('FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20260605T235959Z')
    const occurrences = expandOccurrences(item, twoWeekWindow)
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 3, 5])
  })

  it('round-trips the producer rule format with COUNT', () => {
    const item = makeRecurringItem('FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=4')
    const occurrences = expandOccurrences(item, twoWeekWindow)
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 3, 5, 8])
    expect(occurrences.map((occurrence) => occurrence.id)).toEqual([
      'series-base:0',
      'series-base:1',
      'series-base:2',
      'series-base:3',
    ])
  })

  it('respects the recurrenceEnd column as an expansion bound', () => {
    const item = makeRecurringItem('FREQ=DAILY', { recurrenceEnd: '2026-06-03T23:59:59.000Z' })
    const occurrences = expandOccurrences(item, twoWeekWindow)
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 2, 3])
  })

  it('keeps the final occurrence when recurrenceEnd is stored as UTC midnight of the until date', () => {
    const item = makeRecurringItem('FREQ=WEEKLY;BYDAY=MO;UNTIL=20260608T235959Z', {
      // UTC midnight of the until date (the shape ScheduleActivityDialog persists);
      // built via Date.UTC so the fixed scenario carries no rotting date literal.
      recurrenceEnd: new Date(Date.UTC(2026, 5, 8)).toISOString(),
    })
    const occurrences = expandOccurrences(item, twoWeekWindow)
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 8])
  })

  it('keeps series occurrence indices stable when the window starts mid-series', () => {
    const item = makeRecurringItem('FREQ=DAILY')
    const midSeriesWindow = windowOf(new Date(2026, 5, 3, 0, 0, 0), new Date(2026, 5, 4, 23, 59, 59))
    const occurrences = expandOccurrences(item, midSeriesWindow)
    expect(occurrences.map((occurrence) => occurrence.id)).toEqual(['series-base:2', 'series-base:3'])
  })

  it('caps expansion at 100 occurrences per window', () => {
    const item = makeRecurringItem('FREQ=DAILY')
    const yearWindow = windowOf(new Date(2026, 5, 1, 0, 0, 0), new Date(2027, 5, 1, 0, 0, 0))
    const occurrences = expandOccurrences(item, yearWindow)
    expect(occurrences).toHaveLength(100)
    expect(occurrences[99].id).toBe('series-base:99')
  })

  it('falls back to the series start weekday for WEEKLY without BYDAY', () => {
    const item = makeRecurringItem('FREQ=WEEKLY')
    const occurrences = expandOccurrences(item, twoWeekWindow)
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 8])
    expect(occurrences.every((occurrence) => occurrence.start.getDay() === 1)).toBe(true)
  })

  it('skips the series start day when BYDAY excludes its weekday', () => {
    const item = makeRecurringItem('FREQ=WEEKLY;BYDAY=TU;COUNT=2')
    const occurrences = expandOccurrences(item, twoWeekWindow)
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([2, 9])
    expect(occurrences[0].id).toBe('series-base:0')
  })
})

describe('expandOccurrences — monthly, yearly and intervals', () => {
  function seriesFrom(start: Date, rule: string): CalendarItem {
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    return makeCalendarItem({
      id: 'series',
      start,
      end,
      raw: makePayload({ id: 'series', recurrenceRule: rule, scheduledAt: start.toISOString() }),
    })
  }

  it('honours INTERVAL on a daily rule', () => {
    const item = seriesFrom(new Date(2026, 5, 1, 10, 0), 'FREQ=DAILY;INTERVAL=3;COUNT=4')
    const occurrences = expandOccurrences(item, windowOf(new Date(2026, 5, 1), new Date(2026, 5, 30)))
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 4, 7, 10])
  })

  it('produces fortnightly occurrences for INTERVAL=2 weekly', () => {
    const item = seriesFrom(new Date(2026, 5, 1, 10, 0), 'FREQ=WEEKLY;INTERVAL=2;COUNT=3')
    const occurrences = expandOccurrences(item, windowOf(new Date(2026, 5, 1), new Date(2026, 6, 30)))
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 15, 29])
  })

  it('expands a monthly rule', () => {
    const item = seriesFrom(new Date(2026, 0, 15, 10, 0), 'FREQ=MONTHLY;COUNT=4')
    const occurrences = expandOccurrences(item, windowOf(new Date(2026, 0, 1), new Date(2026, 5, 30)))
    expect(occurrences.map((occurrence) => [occurrence.start.getMonth(), occurrence.start.getDate()])).toEqual([
      [0, 15],
      [1, 15],
      [2, 15],
      [3, 15],
    ])
  })

  it('clamps a 31st-of-the-month rule to short months', () => {
    const item = seriesFrom(new Date(2026, 0, 31, 10, 0), 'FREQ=MONTHLY;COUNT=4')
    const occurrences = expandOccurrences(item, windowOf(new Date(2026, 0, 1), new Date(2026, 5, 30)))
    // January 31 → February 28 (2026 is not a leap year) → March 31 → April 30.
    expect(occurrences.map((occurrence) => [occurrence.start.getMonth(), occurrence.start.getDate()])).toEqual([
      [0, 31],
      [1, 28],
      [2, 31],
      [3, 30],
    ])
  })

  it('clamps to 29 February in a leap year', () => {
    const item = seriesFrom(new Date(2028, 0, 31, 10, 0), 'FREQ=MONTHLY;COUNT=2')
    const occurrences = expandOccurrences(item, windowOf(new Date(2028, 0, 1), new Date(2028, 3, 30)))
    expect(occurrences[1].start.getMonth()).toBe(1)
    expect(occurrences[1].start.getDate()).toBe(29)
  })

  it('expands a yearly rule and clamps 29 February in non-leap years', () => {
    const item = seriesFrom(new Date(2028, 1, 29, 10, 0), 'FREQ=YEARLY;COUNT=3')
    const occurrences = expandOccurrences(item, windowOf(new Date(2028, 0, 1), new Date(2031, 0, 1)))
    expect(occurrences.map((occurrence) => [occurrence.start.getFullYear(), occurrence.start.getDate()])).toEqual([
      [2028, 29],
      [2029, 28],
      [2030, 28],
    ])
  })

  it('keeps the wall-clock time across a DST transition', () => {
    const item = seriesFrom(new Date(2026, 2, 25, 9, 0), 'FREQ=DAILY;COUNT=10')
    const occurrences = expandOccurrences(item, windowOf(new Date(2026, 2, 1), new Date(2026, 3, 30)))
    for (const occurrence of occurrences) {
      expect(occurrence.start.getHours()).toBe(9)
      expect(occurrence.start.getMinutes()).toBe(0)
    }
  })

  it('skips excepted dates without shifting the rest of the series', () => {
    const item = seriesFrom(new Date(2026, 5, 1, 10, 0), 'FREQ=DAILY;COUNT=4;EXDATE=20260602')
    const occurrences = expandOccurrences(item, windowOf(new Date(2026, 5, 1), new Date(2026, 5, 30)))
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 3, 4])
  })

  it('stops at UNTIL', () => {
    const item = seriesFrom(new Date(2026, 5, 1, 10, 0), 'FREQ=DAILY;UNTIL=20260603T235959Z')
    const occurrences = expandOccurrences(item, windowOf(new Date(2026, 5, 1), new Date(2026, 5, 30)))
    expect(occurrences).toHaveLength(3)
  })

  it('expands a wide daily window without stalling', () => {
    const item = seriesFrom(new Date(2026, 0, 1, 10, 0), 'FREQ=DAILY')
    const started = Date.now()
    const occurrences = expandOccurrences(item, windowOf(new Date(2026, 0, 1), new Date(2027, 0, 1)))
    expect(occurrences.length).toBeLessThanOrEqual(100)
    expect(Date.now() - started).toBeLessThan(200)
  })
})
