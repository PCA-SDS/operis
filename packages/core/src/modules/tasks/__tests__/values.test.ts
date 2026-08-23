import {
  dateOrNull,
  isoDate,
  isoInstant,
  normalizeText,
  resolveTimeZone,
  todayInTimeZone,
  zonedDayStartUtc,
  zonedWallClock,
} from '../lib/values'
import { addDaysIso, addMonthsClamped, isoOrNull, lastDayOfMonth } from '../lib/calendar'

describe('calendar arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addDaysIso('2026-02-27', 3)).toBe('2026-03-02')
  })

  it('adds days across a leap day', () => {
    expect(addDaysIso('2024-02-28', 1)).toBe('2024-02-29')
  })

  it('rejects dates that do not exist', () => {
    expect(isoOrNull(2026, 2, 31)).toBeNull()
    expect(isoOrNull(2026, 2, 28)).toBe('2026-02-28')
  })

  it('knows how long each month is', () => {
    expect(lastDayOfMonth(2026, 1)).toBe(28) // February 2026
    expect(lastDayOfMonth(2024, 1)).toBe(29) // February 2024
    expect(lastDayOfMonth(2026, 0)).toBe(31)
  })

  it('clamps when adding months to a long date', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsClamped('2026-12-15', 1)).toBe('2027-01-15')
  })
})

describe('date column helpers', () => {
  it('parses a calendar day to UTC midnight', () => {
    expect(dateOrNull('2026-03-04')?.toISOString()).toBe('2026-03-04T00:00:00.000Z')
  })

  it('treats an absent date as null rather than the epoch', () => {
    expect(dateOrNull(null)).toBeNull()
    expect(dateOrNull(undefined)).toBeNull()
    expect(dateOrNull('')).toBeNull()
  })

  it('renders a stored date back to a calendar day', () => {
    expect(isoDate(new Date('2026-03-04T00:00:00.000Z'))).toBe('2026-03-04')
    expect(isoDate(null)).toBeNull()
  })

  it('renders an instant in full', () => {
    expect(isoInstant(new Date('2026-03-04T09:30:00.000Z'))).toBe('2026-03-04T09:30:00.000Z')
    expect(isoInstant(null)).toBeNull()
  })
})

describe('normalizeText', () => {
  it('turns blank input into null so the column stays clean', () => {
    expect(normalizeText('   ')).toBeNull()
    expect(normalizeText('')).toBeNull()
    expect(normalizeText(null)).toBeNull()
  })

  it('trims real text', () => {
    expect(normalizeText('  hello  ')).toBe('hello')
  })
})

describe('resolveTimeZone', () => {
  it('defaults to UTC when none is supplied', () => {
    expect(resolveTimeZone(undefined)).toBe('UTC')
    expect(resolveTimeZone(null)).toBe('UTC')
  })

  it('accepts a real zone', () => {
    expect(resolveTimeZone('Asia/Singapore')).toBe('Asia/Singapore')
  })

  it('rejects an unknown zone rather than silently falling back', () => {
    expect(() => resolveTimeZone('Mars/Olympus')).toThrow()
  })
})

describe('zone-aware day resolution', () => {
  it('resolves "today" per zone', () => {
    // 2026-03-04T23:30Z is already the 5th in Singapore (UTC+8).
    const instant = new Date('2026-03-04T23:30:00.000Z')
    expect(todayInTimeZone('UTC', instant)).toBe('2026-03-04')
    expect(todayInTimeZone('Asia/Singapore', instant)).toBe('2026-03-05')
  })

  it('resolves an instant to the observer wall clock', () => {
    const instant = new Date('2026-03-04T23:30:00.000Z')
    expect(zonedWallClock(instant, 'UTC')).toEqual({ date: '2026-03-04', time: '23:30' })
    expect(zonedWallClock(instant, 'Asia/Singapore')).toEqual({ date: '2026-03-05', time: '07:30' })
  })

  it('resolves the start of a day in a zone', () => {
    // Midnight in Singapore is 16:00 the previous day in UTC.
    expect(zonedDayStartUtc('2026-03-05', 'Asia/Singapore').toISOString()).toBe(
      '2026-03-04T16:00:00.000Z',
    )
    expect(zonedDayStartUtc('2026-03-05', 'UTC').toISOString()).toBe('2026-03-05T00:00:00.000Z')
  })

  it('resolves the start of a day that begins on a DST transition', () => {
    // New York springs forward on 2026-03-08; midnight is still EST (UTC-5).
    expect(zonedDayStartUtc('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    )
    // …and the following day is already EDT (UTC-4).
    expect(zonedDayStartUtc('2026-03-09', 'America/New_York').toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    )
  })
})
