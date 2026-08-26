import {
  allItemsForDay,
  belongsInAllDayLane,
  layoutTimedDay,
  packAllDayBars,
  packIntervals,
  packMonthRowBars,
  segmentForDay,
  singleDayItemsFor,
} from '../layout'
import { addCalendarDays, startOfLocalDay } from '../time'
import { makeCalendarItem } from './fixtures'

const DAY = new Date(2026, 5, 11)

function at(hours: number, minutes = 0, dayOffset = 0): Date {
  return new Date(2026, 5, 11 + dayOffset, hours, minutes, 0, 0)
}

function timed(id: string, startHour: number, endHour: number, dayOffset = 0) {
  return makeCalendarItem({ id, start: at(startHour, 0, dayOffset), end: at(endHour, 0, dayOffset) })
}

function allDay(id: string, startDayOffset: number, spanDays: number) {
  const start = startOfLocalDay(at(0, 0, startDayOffset))
  return makeCalendarItem({ id, start, end: addCalendarDays(start, spanDays), allDay: true })
}

describe('packIntervals — Google-style expansion', () => {
  it('gives two simultaneous events equal halves', () => {
    const packed = packIntervals([timed('a', 9, 10), timed('b', 9, 10)])
    for (const entry of packed) {
      expect(entry.columns).toBe(2)
      expect(entry.span).toBe(1)
    }
  })

  it('widens an event into columns no concurrent event needs', () => {
    // Three 09:00 events force a 3-column cluster. 'late' runs 10:30-11:00,
    // by which point columns 1 and 2 are free, so it must widen across both
    // instead of being pinned to a third of the width.
    const packed = packIntervals([
      timed('all-morning', 9, 12),
      timed('first', 9, 10),
      timed('second', 9, 10),
      makeCalendarItem({ id: 'late', start: at(10, 30), end: at(11, 0) }),
    ])
    const byId = new Map(packed.map((packedEntry) => [packedEntry.entry.id, packedEntry]))
    expect(byId.get('late')!.columns).toBe(3)
    expect(byId.get('late')!.span).toBe(2)
    // The 09:00 trio genuinely collide, so none of them widens.
    expect(byId.get('all-morning')!.span).toBe(1)
    expect(byId.get('first')!.span).toBe(1)
  })

  it('keeps every event in a dense cluster addressable', () => {
    const items = Array.from({ length: 6 }, (_, index) => timed(`e${index}`, 9, 11))
    const packed = packIntervals(items)
    expect(packed).toHaveLength(6)
    for (const entry of packed) {
      expect(entry.columns).toBe(6)
      expect(entry.span).toBeGreaterThanOrEqual(1)
      expect(entry.column + entry.span).toBeLessThanOrEqual(entry.columns)
    }
  })

  it('does not merge merely adjacent events into one cluster', () => {
    const packed = packIntervals([timed('a', 9, 10), timed('b', 10, 11)])
    for (const entry of packed) expect(entry.columns).toBe(1)
  })

  it('is deterministic for identical inputs in any order', () => {
    const forward = packIntervals([timed('a', 9, 11), timed('b', 9, 10), timed('c', 10, 11)])
    const reverse = packIntervals([timed('c', 10, 11), timed('b', 9, 10), timed('a', 9, 11)])
    expect(forward.map((entry) => [entry.entry.id, entry.column, entry.columns, entry.span])).toEqual(
      reverse.map((entry) => [entry.entry.id, entry.column, entry.columns, entry.span]),
    )
  })
})

describe('segmentForDay', () => {
  it('returns null for a day the entry does not touch', () => {
    expect(segmentForDay(timed('a', 9, 10), addCalendarDays(DAY, 1))).toBeNull()
  })

  it('clips a midnight crossing into two segments with continuation flags', () => {
    const item = makeCalendarItem({ id: 'overnight', start: at(23, 0), end: at(1, 0, 1) })

    const first = segmentForDay(item, DAY)!
    expect(first.startMinutes).toBe(23 * 60)
    expect(first.endMinutes).toBe(1440)
    expect(first.continuesBefore).toBe(false)
    expect(first.continuesAfter).toBe(true)

    const second = segmentForDay(item, addCalendarDays(DAY, 1))!
    expect(second.startMinutes).toBe(0)
    expect(second.endMinutes).toBe(60)
    expect(second.continuesBefore).toBe(true)
    expect(second.continuesAfter).toBe(false)
  })

  it('treats an entry ending exactly at midnight as belonging to the earlier day', () => {
    const item = makeCalendarItem({ id: 'til-midnight', start: at(22, 0), end: at(0, 0, 1) })
    const first = segmentForDay(item, DAY)!
    expect(first.endMinutes).toBe(1440)
    expect(first.continuesAfter).toBe(false)
    expect(segmentForDay(item, addCalendarDays(DAY, 1))).toBeNull()
  })
})

describe('layoutTimedDay', () => {
  it('positions by start time and sizes by duration', () => {
    const [segment] = layoutTimedDay([timed('a', 9, 10)], DAY)
    expect(segment.startMinutes).toBe(540)
    expect(segment.endMinutes).toBe(600)
  })

  it('keeps a short event at its exact minute', () => {
    const item = makeCalendarItem({ id: 'short', start: at(9, 5), end: at(9, 10) })
    const [segment] = layoutTimedDay([item], DAY)
    expect(segment.startMinutes).toBe(545)
    expect(segment.endMinutes).toBe(550)
  })

  it('excludes entries that belong in the all-day lane', () => {
    expect(layoutTimedDay([allDay('holiday', 0, 1)], DAY)).toHaveLength(0)
    expect(layoutTimedDay([timed('marathon', 0, 30)], DAY)).toHaveLength(0)
  })

  it('packs only what actually shares the day', () => {
    // The overnight tail on day 2 must not collide with a 09:00 meeting.
    const overnight = makeCalendarItem({ id: 'overnight', start: at(23, 0), end: at(1, 0, 1) })
    const morning = timed('morning', 9, 10, 1)
    const segments = layoutTimedDay([overnight, morning], addCalendarDays(DAY, 1))
    for (const segment of segments) expect(segment.columns).toBe(1)
  })
})

describe('packAllDayBars', () => {
  const week = Array.from({ length: 7 }, (_, index) => startOfLocalDay(at(0, 0, index)))

  it('renders a multi-day entry as one bar', () => {
    const bars = packAllDayBars([allDay('trip', 0, 3)], week)
    expect(bars).toHaveLength(1)
    expect(bars[0]).toMatchObject({ startIndex: 0, endIndex: 2, lane: 0 })
  })

  it('gives overlapping bars separate lanes', () => {
    const bars = packAllDayBars([allDay('a', 0, 3), allDay('b', 1, 3)], week)
    expect(new Set(bars.map((bar) => bar.lane)).size).toBe(2)
  })

  it('reuses a lane once the previous bar has finished', () => {
    const bars = packAllDayBars([allDay('a', 0, 2), allDay('b', 3, 2)], week)
    expect(bars.every((bar) => bar.lane === 0)).toBe(true)
  })

  it('clips to the visible range and flags continuation', () => {
    const start = startOfLocalDay(at(0, 0, -2))
    const item = makeCalendarItem({ id: 'long', start, end: addCalendarDays(start, 12), allDay: true })
    const [bar] = packAllDayBars([item], week)
    expect(bar.startIndex).toBe(0)
    expect(bar.endIndex).toBe(6)
    expect(bar.continuesBefore).toBe(true)
    expect(bar.continuesAfter).toBe(true)
  })

  it('promotes a timed entry of a full day or more into the lane', () => {
    expect(belongsInAllDayLane(timed('marathon', 0, 25))).toBe(true)
    expect(belongsInAllDayLane(timed('meeting', 9, 10))).toBe(false)
  })
})

describe('packMonthRowBars — the multi-day regression', () => {
  const week = Array.from({ length: 7 }, (_, index) => startOfLocalDay(at(0, 0, index)))

  it('spans every day a multi-day entry covers, not just its first', () => {
    const [bar] = packMonthRowBars([allDay('conference', 0, 4)], week)
    expect(bar.startIndex).toBe(0)
    expect(bar.endIndex).toBe(3)
  })

  it('splits an entry crossing a week boundary into two segments', () => {
    const start = startOfLocalDay(at(0, 0, 5))
    const item = makeCalendarItem({ id: 'across', start, end: addCalendarDays(start, 4), allDay: true })
    const nextWeek = Array.from({ length: 7 }, (_, index) => startOfLocalDay(at(0, 0, 7 + index)))

    const [first] = packMonthRowBars([item], week)
    expect(first).toMatchObject({ startIndex: 5, endIndex: 6, continuesAfter: true })

    const [second] = packMonthRowBars([item], nextWeek)
    expect(second).toMatchObject({ startIndex: 0, endIndex: 1, continuesBefore: true })
  })

  it('treats a timed entry spanning two dates as a bar', () => {
    const item = makeCalendarItem({ id: 'overnight', start: at(23, 0), end: at(1, 0, 1) })
    const bars = packMonthRowBars([item], week)
    expect(bars).toHaveLength(1)
    expect(bars[0]).toMatchObject({ startIndex: 0, endIndex: 1 })
  })

  it('leaves single-day timed entries to the pill list', () => {
    expect(packMonthRowBars([timed('meeting', 9, 10)], week)).toHaveLength(0)
    expect(singleDayItemsFor([timed('meeting', 9, 10)], week[0])).toHaveLength(1)
  })
})

describe('allItemsForDay', () => {
  it('lists every entry touching the day, spanning ones first', () => {
    const items = [timed('meeting', 9, 10), allDay('trip', 0, 3)]
    const listed = allItemsForDay(items, DAY)
    expect(listed.map((item) => item.id)).toEqual(['trip', 'meeting'])
  })

  it('includes a span on its middle day', () => {
    const listed = allItemsForDay([allDay('trip', 0, 3)], addCalendarDays(DAY, 1))
    expect(listed.map((item) => item.id)).toEqual(['trip'])
  })

  it('orders same-kind entries by start time then id', () => {
    const listed = allItemsForDay([timed('b', 11, 12), timed('a', 9, 10)], DAY)
    expect(listed.map((item) => item.id)).toEqual(['a', 'b'])
  })
})
