import {
  MINUTES_PER_DAY,
  addCalendarDays,
  atWallMinutes,
  calendarDaysBetween,
  clampDayMinutes,
  isSameLocalDay,
  localDayKey,
  snapMinutes,
  startOfLocalDay,
  wallMinutes,
} from '../time'

describe('wallMinutes', () => {
  it('reads minutes off the clock, not elapsed time', () => {
    expect(wallMinutes(new Date(2026, 5, 11, 0, 0))).toBe(0)
    expect(wallMinutes(new Date(2026, 5, 11, 9, 30))).toBe(570)
    expect(wallMinutes(new Date(2026, 5, 11, 23, 59))).toBe(1439)
  })

  it('is identical on a DST transition day and an ordinary day', () => {
    // Whatever the runtime zone, 09:00 must read as 540 on every date.
    const springForward = new Date(2026, 2, 29, 9, 0)
    const ordinary = new Date(2026, 5, 11, 9, 0)
    expect(wallMinutes(springForward)).toBe(wallMinutes(ordinary))
  })
})

describe('atWallMinutes', () => {
  it('builds the instant at the requested clock time', () => {
    const day = new Date(2026, 5, 11, 17, 45)
    const built = atWallMinutes(day, 9 * 60 + 30)
    expect(built.getFullYear()).toBe(2026)
    expect(built.getMonth()).toBe(5)
    expect(built.getDate()).toBe(11)
    expect(built.getHours()).toBe(9)
    expect(built.getMinutes()).toBe(30)
  })

  it('rolls minutes past a day into the following date', () => {
    const built = atWallMinutes(new Date(2026, 5, 11), MINUTES_PER_DAY + 90)
    expect(built.getDate()).toBe(12)
    expect(built.getHours()).toBe(1)
    expect(built.getMinutes()).toBe(30)
  })

  it('round-trips through wallMinutes', () => {
    for (const minutes of [0, 15, 375, 720, 1439]) {
      const built = atWallMinutes(new Date(2026, 0, 15), minutes)
      expect(wallMinutes(built)).toBe(minutes)
    }
  })

  it('lands on a real instant across a spring-forward gap', () => {
    // 02:30 may not exist locally; the result must still be a valid instant on
    // or after the requested wall time rather than NaN.
    const built = atWallMinutes(new Date(2026, 2, 29), 150)
    expect(Number.isNaN(built.getTime())).toBe(false)
  })
})

describe('calendarDaysBetween', () => {
  it('counts whole dates regardless of time of day', () => {
    expect(calendarDaysBetween(new Date(2026, 5, 11, 23, 0), new Date(2026, 5, 12, 1, 0))).toBe(1)
    expect(calendarDaysBetween(new Date(2026, 5, 11, 0, 0), new Date(2026, 5, 11, 23, 59))).toBe(0)
  })

  it('is unaffected by a DST transition inside the span', () => {
    expect(calendarDaysBetween(new Date(2026, 2, 28), new Date(2026, 2, 30))).toBe(2)
    expect(calendarDaysBetween(new Date(2026, 9, 24), new Date(2026, 9, 26))).toBe(2)
  })

  it('crosses month and year boundaries', () => {
    expect(calendarDaysBetween(new Date(2026, 0, 31), new Date(2026, 1, 1))).toBe(1)
    expect(calendarDaysBetween(new Date(2026, 11, 31), new Date(2027, 0, 1))).toBe(1)
  })

  it('counts the leap day', () => {
    expect(calendarDaysBetween(new Date(2028, 1, 28), new Date(2028, 2, 1))).toBe(2)
    expect(calendarDaysBetween(new Date(2026, 1, 28), new Date(2026, 2, 1))).toBe(1)
  })
})

describe('addCalendarDays', () => {
  it('holds the wall-clock time across a DST boundary', () => {
    const start = new Date(2026, 2, 28, 9, 0)
    const next = addCalendarDays(start, 2)
    expect(next.getHours()).toBe(9)
    expect(next.getDate()).toBe(30)
  })

  it('rolls over month ends', () => {
    const next = addCalendarDays(new Date(2026, 0, 31, 12, 0), 1)
    expect(next.getMonth()).toBe(1)
    expect(next.getDate()).toBe(1)
  })
})

describe('startOfLocalDay / isSameLocalDay / localDayKey', () => {
  it('normalizes to local midnight', () => {
    const midnight = startOfLocalDay(new Date(2026, 5, 11, 18, 42, 13, 500))
    expect(midnight.getHours()).toBe(0)
    expect(midnight.getMinutes()).toBe(0)
    expect(midnight.getSeconds()).toBe(0)
    expect(midnight.getMilliseconds()).toBe(0)
  })

  it('compares dates, not instants', () => {
    expect(isSameLocalDay(new Date(2026, 5, 11, 0, 1), new Date(2026, 5, 11, 23, 59))).toBe(true)
    expect(isSameLocalDay(new Date(2026, 5, 11, 23, 59), new Date(2026, 5, 12, 0, 1))).toBe(false)
  })

  it('produces a sortable zero-padded key', () => {
    expect(localDayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(localDayKey(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('snapMinutes / clampDayMinutes', () => {
  it('rounds to the nearest increment', () => {
    expect(snapMinutes(7, 15)).toBe(0)
    expect(snapMinutes(8, 15)).toBe(15)
    expect(snapMinutes(374, 30)).toBe(360)
    expect(snapMinutes(376, 30)).toBe(390)
  })

  it('clamps into a single day', () => {
    expect(clampDayMinutes(-10)).toBe(0)
    expect(clampDayMinutes(9999)).toBe(MINUTES_PER_DAY)
    expect(clampDayMinutes(Number.NaN)).toBe(0)
  })
})
