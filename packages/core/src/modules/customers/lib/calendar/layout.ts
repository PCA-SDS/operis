import type { CalendarItem } from '../../components/calendar/types'
import {
  MINUTES_PER_DAY,
  addCalendarDays,
  calendarDaysBetween,
  startOfLocalDay,
  wallMinutes,
} from './time'

/**
 * Calendar geometry. Every function here is pure and returns time-and-column
 * units — never pixels — so views own their own density and the maths stays
 * testable without rendering.
 */

const MINUTES_PER_HOUR = 60

/** At or beyond this length an event belongs in the all-day lane, the way a
 *  multi-day booking does in a mature calendar, rather than as a grid block. */
export const ALL_DAY_LANE_MINUTES = MINUTES_PER_DAY

type Interval = { id: string; start: Date; end: Date }

function overlaps(first: Interval, second: Interval): boolean {
  return first.start.getTime() < second.end.getTime() && second.start.getTime() < first.end.getTime()
}

function compareIntervals(first: Interval, second: Interval): number {
  const startDelta = first.start.getTime() - second.start.getTime()
  if (startDelta !== 0) return startDelta
  const endDelta = second.end.getTime() - first.end.getTime()
  if (endDelta !== 0) return endDelta
  return first.id.localeCompare(second.id)
}

export type PackedInterval<T extends Interval> = {
  entry: T
  column: number
  columns: number
  /** Columns this entry widens into because nothing concurrent occupies them. */
  span: number
}

/**
 * Greedy column packing followed by a rightward expansion pass.
 *
 * The expansion is what stops a cluster of six from shrinking every event to a
 * sixth of the width: an event grows into any column to its right that holds
 * nothing concurrent, so only genuinely simultaneous events share the split.
 */
export function packIntervals<T extends Interval>(entries: T[]): Array<PackedInterval<T>> {
  const sorted = [...entries].sort(compareIntervals)
  const result: Array<PackedInterval<T>> = []

  let cluster: Array<{ entry: T; column: number }> = []
  let columnEnds: number[] = []
  let clusterEnd = Number.NEGATIVE_INFINITY

  const flushCluster = () => {
    if (cluster.length === 0) return
    const columns = columnEnds.length
    for (const member of cluster) {
      let span = 1
      for (let column = member.column + 1; column < columns; column += 1) {
        const blocked = cluster.some(
          (other) => other !== member && other.column === column && overlaps(member.entry, other.entry),
        )
        if (blocked) break
        span += 1
      }
      result.push({ entry: member.entry, column: member.column, columns, span })
    }
    cluster = []
    columnEnds = []
    clusterEnd = Number.NEGATIVE_INFINITY
  }

  for (const entry of sorted) {
    const startTime = entry.start.getTime()
    if (cluster.length > 0 && startTime >= clusterEnd) flushCluster()
    let column = columnEnds.findIndex((columnEnd) => columnEnd <= startTime)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(entry.end.getTime())
    } else {
      columnEnds[column] = entry.end.getTime()
    }
    cluster.push({ entry, column })
    clusterEnd = Math.max(clusterEnd, entry.end.getTime())
  }
  flushCluster()

  return result
}

/** How long an entry runs, in minutes of elapsed time. */
export function durationMinutesOf(item: CalendarItem): number {
  return (item.end.getTime() - item.start.getTime()) / 60_000
}

/**
 * True when an entry belongs in the all-day lane: explicitly all-day, or long
 * enough that a grid block would be meaningless.
 */
export function belongsInAllDayLane(item: CalendarItem): boolean {
  return item.allDay || durationMinutesOf(item) >= ALL_DAY_LANE_MINUTES
}

export type DaySegment = {
  item: CalendarItem
  /** Wall-clock minutes from local midnight; 0 when the entry started earlier. */
  startMinutes: number
  /** Wall-clock minutes from local midnight; 1440 when it runs past this day. */
  endMinutes: number
  continuesBefore: boolean
  continuesAfter: boolean
}

/**
 * Clip one entry to one calendar day.
 *
 * Positions come from wall-clock minutes rather than elapsed milliseconds, so a
 * 09:00 event sits on the 09:00 line even on the 23- and 25-hour days a DST
 * transition produces.
 */
export function segmentForDay(item: CalendarItem, dayStart: Date): DaySegment | null {
  const dayEnd = addCalendarDays(dayStart, 1)
  const dayStartMs = dayStart.getTime()
  const dayEndMs = dayEnd.getTime()
  const startMs = item.start.getTime()
  const endMs = item.end.getTime()
  if (startMs >= dayEndMs || endMs <= dayStartMs) return null

  const continuesBefore = startMs < dayStartMs
  const continuesAfter = endMs > dayEndMs

  const startMinutes = continuesBefore ? 0 : wallMinutes(item.start)
  let endMinutes: number
  if (continuesAfter) {
    endMinutes = MINUTES_PER_DAY
  } else {
    const raw = wallMinutes(item.end)
    // An entry finishing exactly at midnight reads as minute 0 of the next day.
    endMinutes = raw === 0 ? MINUTES_PER_DAY : raw
  }

  return { item, startMinutes, endMinutes, continuesBefore, continuesAfter }
}

export type PositionedSegment = DaySegment & {
  column: number
  columns: number
  span: number
}

/**
 * Everything a day column needs to render its timed region: entries clipped to
 * the day, packed into columns, expanded into free space.
 */
export function layoutTimedDay(items: CalendarItem[], dayStart: Date): PositionedSegment[] {
  const segments: DaySegment[] = []
  for (const item of items) {
    if (belongsInAllDayLane(item)) continue
    const segment = segmentForDay(item, dayStart)
    if (segment) segments.push(segment)
  }
  if (segments.length === 0) return []

  const packable = segments.map((segment) => ({
    id: segment.item.id,
    // Pack on the clipped wall-clock window so a midnight crossing collides
    // only with what it actually shares this day with.
    start: new Date(dayStart.getTime() + segment.startMinutes * 60_000),
    end: new Date(dayStart.getTime() + segment.endMinutes * 60_000),
    segment,
  }))

  return packIntervals(packable).map(({ entry, column, columns, span }) => ({
    ...entry.segment,
    column,
    columns,
    span,
  }))
}

export type AllDayBar = {
  item: CalendarItem
  /** Index into the `days` array where the bar starts rendering. */
  startIndex: number
  /** Inclusive index into the `days` array where the bar stops. */
  endIndex: number
  lane: number
  continuesBefore: boolean
  continuesAfter: boolean
}

function barBoundsForDays(item: CalendarItem, days: Date[]): Omit<AllDayBar, 'lane'> | null {
  if (days.length === 0) return null
  const firstDay = days[0]
  const lastDay = days[days.length - 1]
  const rangeStartMs = firstDay.getTime()
  const rangeEndMs = addCalendarDays(lastDay, 1).getTime()
  if (item.start.getTime() >= rangeEndMs || item.end.getTime() <= rangeStartMs) return null

  const rawStartIndex = calendarDaysBetween(firstDay, startOfLocalDay(item.start))
  // An entry ending exactly at midnight belongs to the previous day, not the
  // one it touches for zero minutes.
  const inclusiveEnd = new Date(item.end.getTime() - 1)
  const rawEndIndex = calendarDaysBetween(firstDay, startOfLocalDay(inclusiveEnd))

  const startIndex = Math.max(0, rawStartIndex)
  const endIndex = Math.min(days.length - 1, rawEndIndex)
  if (endIndex < startIndex) return null

  return {
    item,
    startIndex,
    endIndex,
    continuesBefore: rawStartIndex < 0,
    continuesAfter: rawEndIndex > days.length - 1,
  }
}

function compareBars(first: Omit<AllDayBar, 'lane'>, second: Omit<AllDayBar, 'lane'>): number {
  const startDelta = first.startIndex - second.startIndex
  if (startDelta !== 0) return startDelta
  const spanDelta = second.endIndex - second.startIndex - (first.endIndex - first.startIndex)
  if (spanDelta !== 0) return spanDelta
  if (first.item.allDay !== second.item.allDay) return first.item.allDay ? -1 : 1
  const timeDelta = first.item.start.getTime() - second.item.start.getTime()
  if (timeDelta !== 0) return timeDelta
  return first.item.id.localeCompare(second.item.id)
}

/** Greedy first-fit lane assignment over pre-sorted, non-overlapping-by-lane bars. */
function assignLanes(bounds: Array<Omit<AllDayBar, 'lane'>>): AllDayBar[] {
  const laneEnds: number[] = []
  return bounds.map((bar) => {
    let lane = laneEnds.findIndex((occupiedUntil) => occupiedUntil < bar.startIndex)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(bar.endIndex)
    } else {
      laneEnds[lane] = bar.endIndex
    }
    return { ...bar, lane }
  })
}

/**
 * Pack all-day and multi-day entries into horizontal lanes across `days`, so a
 * single entry renders as one continuous bar and no two bars collide.
 */
export function packAllDayBars(items: CalendarItem[], days: Date[]): AllDayBar[] {
  const bounds: Array<Omit<AllDayBar, 'lane'>> = []
  for (const item of items) {
    if (!belongsInAllDayLane(item)) continue
    const bar = barBoundsForDays(item, days)
    if (bar) bounds.push(bar)
  }
  bounds.sort(compareBars)
  return assignLanes(bounds)
}

/**
 * Month rows use the same lane packing, but every entry that occupies more than
 * one cell becomes a bar — including timed ones — so a span never disappears
 * after its first day.
 */
export function packMonthRowBars(items: CalendarItem[], weekDays: Date[]): AllDayBar[] {
  const spanning = items.filter((item) => {
    if (belongsInAllDayLane(item)) return true
    return !isSameCalendarDay(item.start, new Date(item.end.getTime() - 1))
  })
  const bounds: Array<Omit<AllDayBar, 'lane'>> = []
  for (const item of spanning) {
    const bar = barBoundsForDays(item, weekDays)
    if (bar) bounds.push(bar)
  }
  bounds.sort(compareBars)
  return assignLanes(bounds)
}

function isSameCalendarDay(first: Date, second: Date): boolean {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  )
}

/** Single-cell entries for a month day, in the order a calendar shows them. */
export function singleDayItemsFor(items: CalendarItem[], day: Date): CalendarItem[] {
  return items
    .filter((item) => {
      if (belongsInAllDayLane(item)) return false
      if (!isSameCalendarDay(item.start, new Date(item.end.getTime() - 1))) return false
      return isSameCalendarDay(item.start, day)
    })
    .sort((first, second) => {
      const startDelta = first.start.getTime() - second.start.getTime()
      if (startDelta !== 0) return startDelta
      return first.id.localeCompare(second.id)
    })
}

/** Every entry touching `day`, bars first — what the overflow popover lists. */
export function allItemsForDay(items: CalendarItem[], day: Date): CalendarItem[] {
  const dayStart = startOfLocalDay(day)
  const dayEndMs = addCalendarDays(dayStart, 1).getTime()
  return items
    .filter((item) => item.start.getTime() < dayEndMs && item.end.getTime() > dayStart.getTime())
    .sort((first, second) => {
      const firstBar = belongsInAllDayLane(first)
      const secondBar = belongsInAllDayLane(second)
      if (firstBar !== secondBar) return firstBar ? -1 : 1
      const startDelta = first.start.getTime() - second.start.getTime()
      if (startDelta !== 0) return startDelta
      return first.id.localeCompare(second.id)
    })
}

export type HourRange = { startHour: number; endHour: number }

/** Which hours the grid should scroll to by default. */
export function defaultScrollMinutes(
  now: Date | null,
  workingHours: HourRange,
  visibleMinutes: number,
): number {
  if (now) {
    const centred = wallMinutes(now) - visibleMinutes / 2
    return Math.max(0, Math.min(centred, MINUTES_PER_DAY - visibleMinutes))
  }
  return Math.max(0, Math.min(workingHours.startHour * MINUTES_PER_HOUR, MINUTES_PER_DAY - visibleMinutes))
}
