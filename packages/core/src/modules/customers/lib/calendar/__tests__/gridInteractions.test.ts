import {
  buildMovedRange,
  buildResizedRange,
  MIN_EVENT_DURATION_MINUTES,
  offsetYToMinutes,
  toAllDayRange,
  toTimedRange,
} from '../grid'
import { wallMinutes } from '../time'

const HOUR_PX = 48

function at(hours: number, minutes = 0, day = 11): Date {
  return new Date(2026, 5, day, hours, minutes, 0, 0)
}

describe('offsetYToMinutes', () => {
  it('maps a pixel offset to snapped minutes', () => {
    expect(offsetYToMinutes(0, HOUR_PX)).toBe(0)
    expect(offsetYToMinutes(HOUR_PX * 9, HOUR_PX)).toBe(540)
    expect(offsetYToMinutes(HOUR_PX * 9 + 10, HOUR_PX)).toBe(555)
  })

  it('honours a 30-minute increment', () => {
    expect(offsetYToMinutes(HOUR_PX * 9 + 20, HOUR_PX, 30)).toBe(570)
  })

  it('is safe when the grid has no height yet', () => {
    expect(offsetYToMinutes(120, 0)).toBe(0)
  })
})

describe('buildMovedRange', () => {
  it('moves to a new time and keeps the duration', () => {
    const item = { start: at(9), end: at(10, 30) }
    const moved = buildMovedRange(item, at(0, 0, 12), 14 * 60)
    expect(moved.start.getDate()).toBe(12)
    expect(wallMinutes(moved.start)).toBe(840)
    expect(moved.end.getTime() - moved.start.getTime()).toBe(item.end.getTime() - item.start.getTime())
  })

  it('snaps the drop to the configured increment', () => {
    const moved = buildMovedRange({ start: at(9), end: at(9, 30) }, at(0, 0, 11), 9 * 60 + 7, 15)
    expect(wallMinutes(moved.start)).toBe(540)
  })

  it('lets a move run past midnight into the next day', () => {
    const moved = buildMovedRange({ start: at(9), end: at(11) }, at(0, 0, 11), 23 * 60)
    expect(moved.end.getDate()).toBe(12)
    expect(wallMinutes(moved.end)).toBe(60)
  })
})

describe('buildResizedRange', () => {
  const item = { start: at(9), end: at(10) }

  it('moves the end and holds the start', () => {
    const resized = buildResizedRange(item, 'end', at(0), 11 * 60)
    expect(resized.start).toEqual(item.start)
    expect(wallMinutes(resized.end)).toBe(660)
  })

  it('moves the start and holds the end', () => {
    const resized = buildResizedRange(item, 'start', at(0), 8 * 60)
    expect(wallMinutes(resized.start)).toBe(480)
    expect(resized.end).toEqual(item.end)
  })

  it('never lets the end cross the start', () => {
    const resized = buildResizedRange(item, 'end', at(0), 7 * 60)
    expect(resized.end.getTime()).toBeGreaterThan(resized.start.getTime())
    expect(resized.end.getTime() - resized.start.getTime()).toBe(MIN_EVENT_DURATION_MINUTES * 60_000)
  })

  it('never lets the start cross the end', () => {
    const resized = buildResizedRange(item, 'start', at(0), 23 * 60)
    expect(resized.start.getTime()).toBeLessThan(resized.end.getTime())
    expect(resized.end.getTime() - resized.start.getTime()).toBe(MIN_EVENT_DURATION_MINUTES * 60_000)
  })

  it('cannot produce a zero-length event', () => {
    for (const minutes of [540, 541, 539, 0, 1440]) {
      const resized = buildResizedRange(item, 'end', at(0), minutes)
      expect(resized.end.getTime() - resized.start.getTime()).toBeGreaterThan(0)
    }
  })
})

describe('all-day conversion', () => {
  it('expands a timed entry to whole days', () => {
    const range = toAllDayRange({ start: at(14, 30) })
    expect(wallMinutes(range.start)).toBe(0)
    expect(range.end.getDate()).toBe(12)
    expect(range.end.getTime() - range.start.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('places an all-day entry back on the clock at the drop point', () => {
    const range = toTimedRange(at(0), 14 * 60 + 7, 60, 15)
    expect(wallMinutes(range.start)).toBe(840)
    expect(range.end.getTime() - range.start.getTime()).toBe(60 * 60_000)
  })

  it('round-trips without drifting the date', () => {
    const allDayRange = toAllDayRange({ start: at(14, 30) })
    const backToTimed = toTimedRange(allDayRange.start, 9 * 60)
    expect(backToTimed.start.getDate()).toBe(11)
    expect(wallMinutes(backToTimed.start)).toBe(540)
  })
})
