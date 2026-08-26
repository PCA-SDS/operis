import { isSameDay } from 'date-fns/isSameDay'
import {
  MINUTES_PER_DAY,
  atWallMinutes,
  clampDayMinutes,
  snapMinutes,
  startOfLocalDay,
  wallMinutes,
} from './time'

export const DRAG_SNAP_MINUTES = 15
export const MIN_DRAG_DURATION_MINUTES = 30
/** Shortest event a resize may produce — one snap step. */
export const MIN_EVENT_DURATION_MINUTES = 15

export type SnapIncrement = 15 | 30

export function isWeekendDay(date: Date): boolean {
  const weekday = date.getDay()
  return weekday === 0 || weekday === 6
}

export function applyWeekendVisibility(
  days: Date[],
  showWeekends: boolean,
  keepWeekendDate?: Date | null,
): Date[] {
  if (showWeekends) return days
  const workingDays = days.filter(
    (day) => !isWeekendDay(day) || (keepWeekendDate != null && isSameDay(day, keepWeekendDate)),
  )
  return workingDays.length > 0 ? workingDays : days
}

/** Pointer offset inside a day column to snapped wall-clock minutes. */
export function offsetYToMinutes(
  offsetY: number,
  hourHeightPx: number,
  snap: number = DRAG_SNAP_MINUTES,
): number {
  if (hourHeightPx <= 0) return 0
  return snapMinutes((offsetY / hourHeightPx) * 60, snap)
}

export type DragRange = { start: Date; end: Date }

export function buildDragRange(dayStart: Date, startMinutes: number, endMinutes: number): DragRange {
  let lower = clampDayMinutes(Math.min(startMinutes, endMinutes))
  let upper = clampDayMinutes(Math.max(startMinutes, endMinutes))
  if (upper - lower < MIN_DRAG_DURATION_MINUTES) upper = lower + MIN_DRAG_DURATION_MINUTES
  if (upper > MINUTES_PER_DAY) {
    upper = MINUTES_PER_DAY
    lower = Math.max(0, upper - MIN_DRAG_DURATION_MINUTES)
  }
  return { start: atWallMinutes(dayStart, lower), end: atWallMinutes(dayStart, upper) }
}

/**
 * Move an event to a new day and start minute, holding its duration.
 *
 * Duration is carried as elapsed milliseconds so a move across a DST boundary
 * keeps the meeting the same length rather than the same wall-clock end.
 */
export function buildMovedRange(
  item: { start: Date; end: Date },
  targetDay: Date,
  targetStartMinutes: number,
  snap: number = DRAG_SNAP_MINUTES,
): DragRange {
  const durationMs = Math.max(item.end.getTime() - item.start.getTime(), MIN_EVENT_DURATION_MINUTES * 60_000)
  const start = atWallMinutes(startOfLocalDay(targetDay), snapMinutes(targetStartMinutes, snap))
  return { start, end: new Date(start.getTime() + durationMs) }
}

export type ResizeEdge = 'start' | 'end'

/**
 * Resize one edge of an event, keeping the other fixed and never letting the
 * range invert or collapse below one snap step.
 */
export function buildResizedRange(
  item: { start: Date; end: Date },
  edge: ResizeEdge,
  day: Date,
  pointerMinutes: number,
  snap: number = DRAG_SNAP_MINUTES,
): DragRange {
  const dayStart = startOfLocalDay(day)
  const minimumMs = MIN_EVENT_DURATION_MINUTES * 60_000
  const snapped = snapMinutes(pointerMinutes, snap)

  if (edge === 'start') {
    const candidate = atWallMinutes(dayStart, snapped)
    const latest = new Date(item.end.getTime() - minimumMs)
    return { start: candidate.getTime() > latest.getTime() ? latest : candidate, end: item.end }
  }

  const candidate = atWallMinutes(dayStart, snapped)
  const earliest = new Date(item.start.getTime() + minimumMs)
  return { start: item.start, end: candidate.getTime() < earliest.getTime() ? earliest : candidate }
}

/** Convert a timed range into the whole-day range an all-day entry occupies. */
export function toAllDayRange(item: { start: Date }): DragRange {
  const start = startOfLocalDay(item.start)
  return { start, end: atWallMinutes(start, MINUTES_PER_DAY) }
}

/** Place an all-day entry back into the timed grid at a pointer position. */
export function toTimedRange(
  day: Date,
  pointerMinutes: number,
  durationMinutes: number = MIN_DRAG_DURATION_MINUTES,
  snap: number = DRAG_SNAP_MINUTES,
): DragRange {
  const start = atWallMinutes(startOfLocalDay(day), snapMinutes(pointerMinutes, snap))
  return { start, end: new Date(start.getTime() + durationMinutes * 60_000) }
}

/** Minutes from local midnight for the moment shown on the clock. */
export function minutesOfDay(date: Date): number {
  return wallMinutes(date)
}
