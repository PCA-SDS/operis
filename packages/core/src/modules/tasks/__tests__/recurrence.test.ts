import {
  advanceAfterCompletion,
  firstOccurrenceOnOrAfter,
  nextOccurrenceAfter,
  normalizeRecurrence,
  toRecurrenceDto,
} from '../lib/recurrence'

describe('normalizeRecurrence', () => {
  it('takes the weekday from the base date when the rule does not name one', () => {
    // 2026-03-04 is a Wednesday.
    expect(normalizeRecurrence({ freq: 'weekly' }, '2026-03-04')).toEqual({
      freq: 'weekly',
      weekday: 3,
      dayOfMonth: null,
    })
  })

  it('keeps an explicit weekday over the base date', () => {
    expect(normalizeRecurrence({ freq: 'weekly', weekday: 1 }, '2026-03-04')).toEqual({
      freq: 'weekly',
      weekday: 1,
      dayOfMonth: null,
    })
  })

  it('takes the day of month from the base date for monthly rules', () => {
    expect(normalizeRecurrence({ freq: 'monthly' }, '2026-03-31')).toEqual({
      freq: 'monthly',
      weekday: null,
      dayOfMonth: 31,
    })
  })

  it('carries no anchor for daily and weekday rules', () => {
    expect(normalizeRecurrence({ freq: 'daily' }, '2026-03-04')).toEqual({
      freq: 'daily',
      weekday: null,
      dayOfMonth: null,
    })
    expect(normalizeRecurrence({ freq: 'weekdays' }, '2026-03-04')).toEqual({
      freq: 'weekdays',
      weekday: null,
      dayOfMonth: null,
    })
  })
})

describe('firstOccurrenceOnOrAfter', () => {
  const daily = { freq: 'daily' as const, weekday: null, dayOfMonth: null }
  const weekdays = { freq: 'weekdays' as const, weekday: null, dayOfMonth: null }

  it('returns the same day for a daily rule', () => {
    expect(firstOccurrenceOnOrAfter(daily, '2026-03-04')).toBe('2026-03-04')
  })

  it('pushes a weekday rule off the weekend', () => {
    // 2026-03-07 Saturday, 2026-03-08 Sunday, 2026-03-09 Monday.
    expect(firstOccurrenceOnOrAfter(weekdays, '2026-03-07')).toBe('2026-03-09')
    expect(firstOccurrenceOnOrAfter(weekdays, '2026-03-08')).toBe('2026-03-09')
    expect(firstOccurrenceOnOrAfter(weekdays, '2026-03-06')).toBe('2026-03-06')
  })

  it('moves forward to the next matching weekday', () => {
    const monday = { freq: 'weekly' as const, weekday: 1, dayOfMonth: null }
    expect(firstOccurrenceOnOrAfter(monday, '2026-03-04')).toBe('2026-03-09')
    expect(firstOccurrenceOnOrAfter(monday, '2026-03-09')).toBe('2026-03-09')
  })

  it('clamps a monthly anchor to a short month without losing it', () => {
    const thirtyFirst = { freq: 'monthly' as const, weekday: null, dayOfMonth: 31 }
    // February has no 31st, so the occurrence lands on the 28th…
    expect(firstOccurrenceOnOrAfter(thirtyFirst, '2026-02-01')).toBe('2026-02-28')
    // …and March still gets the 31st, because the anchor was never rewritten.
    expect(firstOccurrenceOnOrAfter(thirtyFirst, '2026-03-01')).toBe('2026-03-31')
  })

  it('rolls a monthly anchor into the next month once the day has passed', () => {
    const fifth = { freq: 'monthly' as const, weekday: null, dayOfMonth: 5 }
    expect(firstOccurrenceOnOrAfter(fifth, '2026-03-10')).toBe('2026-04-05')
  })
})

describe('nextOccurrenceAfter', () => {
  it('never returns the date it was given', () => {
    const daily = { freq: 'daily' as const, weekday: null, dayOfMonth: null }
    expect(nextOccurrenceAfter(daily, '2026-03-04')).toBe('2026-03-05')
  })
})

describe('advanceAfterCompletion', () => {
  const daily = { freq: 'daily' as const, weekday: null, dayOfMonth: null }

  it('advances from today when the task is overdue', () => {
    // A daily task last due a week ago must not replay every missed day.
    expect(advanceAfterCompletion(daily, '2026-02-25', '2026-03-04')).toBe('2026-03-05')
  })

  it('advances from the due date when it is still in the future', () => {
    expect(advanceAfterCompletion(daily, '2026-03-10', '2026-03-04')).toBe('2026-03-11')
  })

  it('advances from today when there is no due date at all', () => {
    expect(advanceAfterCompletion(daily, null, '2026-03-04')).toBe('2026-03-05')
  })

  it('skips the weekend for a weekday rule completed on a Friday', () => {
    const weekdays = { freq: 'weekdays' as const, weekday: null, dayOfMonth: null }
    // 2026-03-06 is a Friday; the next occurrence is Monday the 9th.
    expect(advanceAfterCompletion(weekdays, '2026-03-06', '2026-03-06')).toBe('2026-03-09')
  })
})

describe('toRecurrenceDto', () => {
  it('returns null when the row carries no frequency', () => {
    expect(toRecurrenceDto({ recurrenceFreq: null })).toBeNull()
  })

  it('maps the stored columns onto the wire shape', () => {
    expect(
      toRecurrenceDto({ recurrenceFreq: 'weekly', recurrenceWeekday: 2, recurrenceDayOfMonth: null }),
    ).toEqual({ freq: 'weekly', weekday: 2, dayOfMonth: null })
  })
})
