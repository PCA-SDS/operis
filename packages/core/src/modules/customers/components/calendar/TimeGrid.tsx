"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { layoutTimedDay, packAllDayBars, type PositionedSegment } from '../../lib/calendar/layout'
import { resolveJoinUrl } from '../../lib/calendar/mapItem'
import { getVisibleRange } from '../../lib/calendar/range'
import {
  applyWeekendVisibility,
  buildDragRange,
  buildMovedRange,
  buildResizedRange,
  DRAG_SNAP_MINUTES,
  MIN_EVENT_DURATION_MINUTES,
  minutesOfDay,
  toAllDayRange,
  toTimedRange,
  type ResizeEdge,
} from '../../lib/calendar/grid'
import {
  HOURS_PER_DAY,
  MINUTES_PER_DAY,
  addCalendarDays,
  formatTimeZoneLabel,
  isSameLocalDay,
  snapMinutes,
} from '../../lib/calendar/time'
import { EventBlock, formatTimeRange } from './EventBlock'
import { BAR_ROW_GAP_PX, BAR_ROW_HEIGHT_PX, CalendarBar } from './CalendarBar'
import { EventPeekPopover } from './EventPeekPopover'
import { useNowTick } from './useNowTick'
import { isTaskItem } from './types'
import type { CalendarItem, CalendarReschedule, TimeGridProps } from './types'

/**
 * One hour of grid. A mature calendar sizes an hour so a 30-minute meeting is
 * still a readable card and a working day fits without scrolling — 48px does
 * both, and every other measure here is derived from it rather than guessed.
 */
const HOUR_HEIGHT_PX = 48
/** Shortest card that can still show a title. */
const MIN_BLOCK_HEIGHT_PX = 18
const BLOCK_VERTICAL_GAP_PX = 1
/** Gutter between two concurrent cards, so a shared slot still reads as two. */
const COLUMN_GAP_PX = 2
const DEFAULT_VISIBLE_ALL_DAY_ROWS = 2
const DRAG_THRESHOLD_PX = 4
const DEFAULT_WORKING_HOURS = { startHour: 8, endHour: 18 }
/** Width of the hour gutter, shared by the header corner and the grid. */
const GUTTER_CLASS = 'w-14 shrink-0 md:w-16'

/**
 * Divider between two day columns, keyed off the index rather than `last:`.
 *
 * The timed strip also holds the now-indicator overlay, and that overlay — not
 * the seventh day — is the real `:last-child`, so `last:border-e-0` never fired
 * there. It left a line down the grid's right edge that the all-day lane above
 * has no counterpart for, and because `flex-basis: 0` splits only what the
 * borders leave over, one extra border shifted every column a fraction of a
 * pixel out of step with that lane. The overlay is conditional, so both faults
 * came and went with the current time being on screen.
 */
function dayDividerClass(index: number, total: number) {
  return index === total - 1 ? null : 'border-e border-border'
}

type Gesture =
  | { kind: 'create'; dayIndex: number; anchorMinutes: number; pointerMinutes: number; moved: boolean }
  | {
      kind: 'move'
      item: CalendarItem
      dayIndex: number
      startMinutes: number
      overAllDay: boolean
      moved: boolean
    }
  | { kind: 'resize'; item: CalendarItem; edge: ResizeEdge; dayIndex: number; pointerMinutes: number; moved: boolean }

type ConflictBadgeProps = { count: number }

function ConflictBadge({ count }: ConflictBadgeProps) {
  const t = useT()
  const label =
    count === 1
      ? t('customers.calendar.grid.conflictCount', '1 conflict')
      : t('customers.calendar.grid.conflictsCount', '{count} conflicts', { count })
  return (
    <span className="pointer-events-none absolute start-1 top-1 z-40 inline-flex items-center gap-1 rounded-full bg-status-error-bg px-2 py-0.5 text-overline font-medium uppercase tracking-wide text-status-error-text">
      <span aria-hidden className="size-1.5 rounded-full bg-status-error-icon" />
      {label}
    </span>
  )
}

function minutesToPx(minutes: number): number {
  return (minutes / 60) * HOUR_HEIGHT_PX
}

function segmentKey(segment: PositionedSegment): string {
  return `${segment.item.id}:${segment.startMinutes}`
}

/**
 * Geometry for one packed segment.
 *
 * Concurrent events split their slot evenly and each widens into any free
 * column to its right — the layout a mature calendar uses, and the reason a
 * cluster of six does not shrink every card to a sixth of the column.
 */
function segmentGeometry(segment: PositionedSegment): { insetInlineStart: string; width: string } {
  const startPercent = (segment.column / segment.columns) * 100
  const widthPercent = (segment.span / segment.columns) * 100
  return {
    insetInlineStart: `calc(${startPercent}% + ${segment.column * COLUMN_GAP_PX}px)`,
    width: `calc(${widthPercent}% - ${COLUMN_GAP_PX}px)`,
  }
}

export function TimeGrid({
  days,
  anchor,
  items,
  conflictIds,
  showWeekends,
  showConflicts,
  aiSummaries,
  canManage = true,
  highlightItemId,
  snapMinutes: snapPreference = DRAG_SNAP_MINUTES,
  workingHours = DEFAULT_WORKING_HOURS,
  onItemClick,
  onJoin,
  onCreateRange,
  onReschedule,
}: TimeGridProps) {
  const t = useT()
  const locale = useLocale()
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const gridRef = React.useRef<HTMLDivElement | null>(null)
  const columnsRef = React.useRef<HTMLDivElement | null>(null)
  const allDayLaneRef = React.useRef<HTMLDivElement | null>(null)

  const didInitialScroll = React.useRef(false)

  /**
   * Width the vertical scrollbar takes from the timed region.
   *
   * The header and the all-day lane sit OUTSIDE the scroll container so they
   * stay pinned, which means the scrollbar narrows the hour columns and not
   * them. Each column is `flex-1`, so the shortfall is divided among the days
   * and the error compounds left to right — measured at 2px on the first
   * separator and 11px by the last, which is the whole scrollbar. Reserving the
   * same width on the pinned rows puts all three on one content width.
   */
  const [scrollbarWidth, setScrollbarWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const measure = () => {
      const next = scroller.offsetWidth - scroller.clientWidth
      setScrollbarWidth((current) => (current === next ? current : next))
    }
    measure()
    // The scrollbar appears and disappears with the content, so watch the inner
    // grid too — resizing the scroller alone does not cover a day gaining rows.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(scroller)
    if (gridRef.current) observer?.observe(gridRef.current)
    return () => observer?.disconnect()
  }, [])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [gesture, setGesture] = React.useState<Gesture | null>(null)
  const [allDayExpanded, setAllDayExpanded] = React.useState(false)
  const gestureOriginRef = React.useRef<{ x: number; y: number } | null>(null)

  const nowMs = useNowTick()
  const anchorMs = anchor.getTime()

  const dayStarts = React.useMemo(() => {
    const rangeStart = getVisibleRange(days === 7 ? 'week' : 'day', new Date(anchorMs), 0).from
    const all = Array.from({ length: days }, (_, index) => addCalendarDays(rangeStart, index))
    return days === 7 ? applyWeekendVisibility(all, showWeekends, new Date()) : all
  }, [days, anchorMs, showWeekends])

  const timedByDay = React.useMemo(
    () => dayStarts.map((dayStart) => layoutTimedDay(items, dayStart)),
    [dayStarts, items],
  )

  const allDayBars = React.useMemo(() => packAllDayBars(items, dayStarts), [items, dayStarts])

  const allDayLaneCount = React.useMemo(
    () => allDayBars.reduce((max, bar) => Math.max(max, bar.lane + 1), 0),
    [allDayBars],
  )
  const visibleAllDayRows = allDayExpanded
    ? allDayLaneCount
    : Math.min(allDayLaneCount, DEFAULT_VISIBLE_ALL_DAY_ROWS)
  const hiddenAllDayCount = allDayBars.filter((bar) => bar.lane >= visibleAllDayRows).length

  const formatters = React.useMemo(
    () => ({
      dayNumber: new Intl.DateTimeFormat(locale, { day: 'numeric' }),
      weekdayShort: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
      fullDate: new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    }),
    [locale],
  )

  const hourLabels = React.useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { hour: 'numeric' })
    return Array.from({ length: HOURS_PER_DAY }, (_, hour) => formatter.format(new Date(2026, 0, 1, hour)))
  }, [locale])

  const timeZoneAbbreviation = React.useMemo(() => {
    const label = formatTimeZoneLabel()
    const match = /\(([^)]+)\)/.exec(label)
    return match ? match[1] : label
  }, [])

  const canCreate = canManage && Boolean(onCreateRange)

  // Scroll to the current time when today is on screen, otherwise to the start
  // of the working day — never to a hardcoded hour.
  React.useEffect(() => {
    const node = scrollRef.current
    if (!node || didInitialScroll.current) return
    const today = dayStarts.some((day) => isSameLocalDay(day, new Date(nowMs)))
    const visibleMinutes = (node.clientHeight / HOUR_HEIGHT_PX) * 60
    const targetMinutes = today
      ? Math.max(0, minutesOfDay(new Date(nowMs)) - visibleMinutes / 2)
      : workingHours.startHour * 60
    node.scrollTop = Math.max(0, Math.min(minutesToPx(targetMinutes), node.scrollHeight - node.clientHeight))
    didInitialScroll.current = true
  }, [dayStarts, nowMs, workingHours.startHour])

  const pointerToCell = React.useCallback(
    (clientX: number, clientY: number): { dayIndex: number; minutes: number } | null => {
      const grid = gridRef.current
      const columns = columnsRef.current
      if (!grid || !columns) return null
      const gridRect = grid.getBoundingClientRect()
      const columnsRect = columns.getBoundingClientRect()
      const rawMinutes = ((clientY - gridRect.top) / HOUR_HEIGHT_PX) * 60
      const columnWidth = columnsRect.width / dayStarts.length
      const rawIndex = Math.floor((clientX - columnsRect.left) / columnWidth)
      return {
        dayIndex: Math.max(0, Math.min(dayStarts.length - 1, rawIndex)),
        minutes: Math.max(0, Math.min(MINUTES_PER_DAY, rawMinutes)),
      }
    },
    [dayStarts.length],
  )

  const isOverAllDayLane = React.useCallback((clientX: number, clientY: number): boolean => {
    const lane = allDayLaneRef.current
    if (!lane) return false
    const rect = lane.getBoundingClientRect()
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  }, [])

  const beginCreate = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!onCreateRange || event.button !== 0) return
      const cell = pointerToCell(event.clientX, event.clientY)
      if (!cell) return
      const snapped = snapMinutes(cell.minutes, snapPreference)
      gestureOriginRef.current = { x: event.clientX, y: event.clientY }
      setGesture({
        kind: 'create',
        dayIndex: cell.dayIndex,
        anchorMinutes: snapped,
        pointerMinutes: snapped,
        moved: false,
      })
    },
    [onCreateRange, pointerToCell, snapPreference],
  )

  const beginMove = React.useCallback(
    (item: CalendarItem, event: React.PointerEvent<HTMLElement>) => {
      if (!onReschedule || !canManage || event.button !== 0) return
      const cell = pointerToCell(event.clientX, event.clientY)
      if (!cell) return
      gestureOriginRef.current = { x: event.clientX, y: event.clientY }
      setGesture({
        kind: 'move',
        item,
        dayIndex: cell.dayIndex,
        startMinutes: snapMinutes(minutesOfDay(item.start), snapPreference),
        overAllDay: false,
        moved: false,
      })
    },
    [canManage, onReschedule, pointerToCell, snapPreference],
  )

  const beginResize = React.useCallback(
    (item: CalendarItem, edge: ResizeEdge, event: React.PointerEvent<HTMLElement>) => {
      if (!onReschedule || !canManage || event.button !== 0) return
      event.stopPropagation()
      const cell = pointerToCell(event.clientX, event.clientY)
      if (!cell) return
      gestureOriginRef.current = { x: event.clientX, y: event.clientY }
      setGesture({ kind: 'resize', item, edge, dayIndex: cell.dayIndex, pointerMinutes: cell.minutes, moved: false })
    },
    [canManage, onReschedule, pointerToCell],
  )

  const beginAllDayMove = React.useCallback(
    (item: CalendarItem, event: React.PointerEvent<HTMLElement>) => {
      if (!onReschedule || !canManage || event.button !== 0) return
      gestureOriginRef.current = { x: event.clientX, y: event.clientY }
      setGesture({ kind: 'move', item, dayIndex: 0, startMinutes: 0, overAllDay: true, moved: false })
    },
    [canManage, onReschedule],
  )

  // Pointer tracking lives on the window while a gesture runs: pointer capture
  // would pin every event to the timed grid and make the all-day lane
  // unreachable as a drop target.
  const gestureRef = React.useRef<Gesture | null>(null)
  gestureRef.current = gesture

  React.useEffect(() => {
    if (!gesture) return
    const handleMove = (event: PointerEvent) => {
      const origin = gestureOriginRef.current
      const movedFarEnough =
        origin != null &&
        (Math.abs(event.clientX - origin.x) > DRAG_THRESHOLD_PX ||
          Math.abs(event.clientY - origin.y) > DRAG_THRESHOLD_PX)
      const cell = pointerToCell(event.clientX, event.clientY)
      if (!cell) return
      const overAllDay = isOverAllDayLane(event.clientX, event.clientY)
      setGesture((current) => {
        if (!current) return current
        const moved = current.moved || movedFarEnough
        if (current.kind === 'create') {
          return { ...current, pointerMinutes: snapMinutes(cell.minutes, snapPreference), moved }
        }
        if (current.kind === 'move') {
          return {
            ...current,
            dayIndex: cell.dayIndex,
            startMinutes: snapMinutes(cell.minutes, snapPreference),
            overAllDay,
            moved,
          }
        }
        return { ...current, dayIndex: cell.dayIndex, pointerMinutes: cell.minutes, moved }
      })
    }

    const handleUp = (event: PointerEvent) => {
      const current = gestureRef.current
      gestureOriginRef.current = null
      setGesture(null)
      if (!current || !current.moved) return
      const day = dayStarts[current.dayIndex]
      if (!day) return

      if (current.kind === 'create') {
        const range = buildDragRange(day, current.anchorMinutes, current.pointerMinutes)
        onCreateRange?.(range.start, range.end)
        return
      }
      if (!onReschedule) return

      if (current.kind === 'move') {
        // Dropping into the all-day lane converts the entry; dropping out of it
        // puts the entry back on the clock at the pointer.
        if (isOverAllDayLane(event.clientX, event.clientY)) {
          const range = toAllDayRange({ start: day })
          onReschedule({ item: current.item, start: range.start, end: range.end, allDay: true })
          return
        }
        if (current.item.allDay) {
          const range = toTimedRange(day, current.startMinutes, undefined, snapPreference)
          onReschedule({ item: current.item, start: range.start, end: range.end, allDay: false })
          return
        }
        const range = buildMovedRange(current.item, day, current.startMinutes, snapPreference)
        onReschedule({ item: current.item, start: range.start, end: range.end, allDay: false })
        return
      }

      const range = buildResizedRange(current.item, current.edge, day, current.pointerMinutes, snapPreference)
      onReschedule({ item: current.item, start: range.start, end: range.end, allDay: false })
    }

    const handleCancel = () => {
      gestureOriginRef.current = null
      setGesture(null)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
    }
  }, [
    gesture,
    dayStarts,
    isOverAllDayLane,
    onCreateRange,
    onReschedule,
    pointerToCell,
    snapPreference,
  ])

  const previewRange = React.useMemo(() => {
    if (!gesture || !gesture.moved) return null
    const day = dayStarts[gesture.dayIndex]
    if (!day) return null
    if (gesture.kind === 'create') {
      return { ...buildDragRange(day, gesture.anchorMinutes, gesture.pointerMinutes), dayIndex: gesture.dayIndex }
    }
    if (gesture.kind === 'move') {
      if (gesture.overAllDay || gesture.item.allDay) return null
      return { ...buildMovedRange(gesture.item, day, gesture.startMinutes, snapPreference), dayIndex: gesture.dayIndex }
    }
    return {
      ...buildResizedRange(gesture.item, gesture.edge, day, gesture.pointerMinutes, snapPreference),
      dayIndex: gesture.dayIndex,
    }
  }, [gesture, dayStarts, snapPreference])

  const draggingItemId = gesture && gesture.kind !== 'create' ? gesture.item.id : null
  const allDayDropActive = gesture?.kind === 'move' && gesture.moved && gesture.overAllDay

  /** Keyboard equivalent of drag and resize, so neither depends on a pointer. */
  const handleNudge = React.useCallback(
    (item: CalendarItem, minutes: number, mode: 'move' | 'resize') => {
      if (!onReschedule || !canManage) return
      if (mode === 'move') {
        // An all-day entry moves in whole days; a timed one in snap steps.
        const step = item.allDay ? Math.sign(minutes) : 0
        const start = item.allDay
          ? addCalendarDays(item.start, step)
          : new Date(item.start.getTime() + minutes * 60_000)
        const end = item.allDay
          ? addCalendarDays(item.end, step)
          : new Date(item.end.getTime() + minutes * 60_000)
        onReschedule({ item, start, end, allDay: item.allDay })
        return
      }
      // A task has no duration to extend — its record stores a due moment only.
      if (item.allDay || isTaskItem(item)) return
      const end = new Date(item.end.getTime() + minutes * 60_000)
      if (end.getTime() - item.start.getTime() < MIN_EVENT_DURATION_MINUTES * 60_000) return
      onReschedule({ item, start: item.start, end, allDay: false })
    },
    [canManage, onReschedule],
  )

  const gridLabel =
    days === 1
      ? formatters.fullDate.format(dayStarts[0] ?? anchor)
      : t('customers.calendar.views.week', 'Week')

  const showNowIndicator = dayStarts.some((day) => isSameLocalDay(day, new Date(nowMs)))
  const nowMinutes = minutesOfDay(new Date(nowMs))
  const nowIndex = dayStarts.findIndex((day) => isSameLocalDay(day, new Date(nowMs)))
  const nowLabel = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(nowMs)),
    [locale, nowMs],
  )

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border bg-surface"
      role="grid"
      aria-label={gridLabel}
      aria-rowcount={HOURS_PER_DAY}
      aria-colcount={dayStarts.length}
    >
      {/* Header and all-day lane sit outside the scroll container, so they stay
          pinned while the timed region scrolls — which is also why they have to
          reserve the width the scrollbar takes from that region, or their day
          columns land on different x positions than the hours below. The
          padding is a logical property so it follows the writing direction,
          like the `border-e` / `pe-*` used throughout this grid. */}
      <div
        className="shrink-0 bg-surface"
        style={scrollbarWidth ? { paddingInlineEnd: scrollbarWidth } : undefined}
      >
        <div className="flex" role="row">
          {/* The gutter corner carries the timezone, the way a calendar labels
              the axis it is measuring against. */}
          <div
            className={cn(
              GUTTER_CLASS,
              'flex items-end justify-end border-e border-border pb-1 pe-1.5 md:pe-2',
            )}
          >
            <span className="text-overline font-medium leading-none text-muted-foreground">
              <span aria-hidden>{timeZoneAbbreviation}</span>
              <span className="sr-only">
                {t('customers.calendar.footer.timezone', 'Timezone: {timezone}', {
                  timezone: formatTimeZoneLabel(),
                })}
              </span>
            </span>
          </div>
          {dayStarts.map((dayStart, index) => {
            const today = isSameLocalDay(dayStart, new Date(nowMs))
            return (
              <div
                key={dayStart.getTime()}
                role="columnheader"
                aria-colindex={index + 1}
                // The split weekday/numeral is a visual arrangement; screen
                // readers get the whole date as one phrase.
                aria-label={formatters.fullDate.format(dayStart)}
                className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 pb-1.5 pt-2"
              >
                <span
                  aria-hidden
                  className={cn(
                    'text-xs font-medium uppercase leading-none tracking-wide',
                    today ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {formatters.weekdayShort.format(dayStart).toLocaleUpperCase(locale)}
                </span>
                {/* A large, light numeral is the calendar's date anchor; today
                    inverts into a filled disc rather than merely changing hue. */}
                <span
                  aria-hidden
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full text-2xl font-normal leading-none tabular-nums transition-colors',
                    today ? 'bg-primary font-medium text-primary-foreground' : 'text-foreground',
                  )}
                >
                  {formatters.dayNumber.format(dayStart)}
                </span>
              </div>
            )
          })}
        </div>

        {/* The all-day lane always renders, so it stays a drop target even when
            empty. */}
        <div className="flex border-y border-border">
          <div className={cn(GUTTER_CLASS, 'flex items-start justify-end border-e border-border px-1 py-1 md:px-2')}>
            <span className="text-overline leading-tight text-muted-foreground">
              {t('customers.calendar.grid.allDay', 'All day')}
            </span>
          </div>
          <div
            ref={allDayLaneRef}
            className={cn(
              'relative min-w-0 flex-1 transition-colors',
              allDayDropActive && 'bg-accent-strong/15 ring-1 ring-inset ring-primary',
            )}
            style={{
              minHeight: BAR_ROW_HEIGHT_PX + BAR_ROW_GAP_PX * 2,
              height: Math.max(1, visibleAllDayRows) * (BAR_ROW_HEIGHT_PX + BAR_ROW_GAP_PX) + BAR_ROW_GAP_PX,
            }}
          >
            <div aria-hidden className="absolute inset-0 flex">
              {dayStarts.map((dayStart, index) => (
                <div
                  key={dayStart.getTime()}
                  className={cn('min-w-0 flex-1', dayDividerClass(index, dayStarts.length))}
                />
              ))}
            </div>
            {allDayBars
              .filter((bar) => bar.lane < visibleAllDayRows)
              .map((bar) => (
                <EventPeekPopover
                  key={`${bar.item.id}-allday`}
                  item={bar.item}
                  open={selectedId === bar.item.id}
                  joinUrl={resolveJoinUrl(bar.item.location)}
                  aiSummaries={aiSummaries}
                  canManage={canManage}
                  onOpenChange={(open) => setSelectedId(open ? bar.item.id : null)}
                  onJoin={onJoin}
                  onEdit={onItemClick}
                >
                  <CalendarBar
                    bar={bar}
                    dayCount={dayStarts.length}
                    label={`${bar.item.title || t('customers.calendar.grid.untitled', 'Untitled')}, ${t('customers.calendar.grid.allDay', 'All day')}`}
                    conflicted={showConflicts && conflictIds.has(bar.item.id)}
                    highlighted={highlightItemId === bar.item.id}
                    selected={selectedId === bar.item.id}
                    dragging={draggingItemId === bar.item.id}
                    nowMs={nowMs}
                    onPointerDown={
                      canManage && onReschedule ? (event) => beginAllDayMove(bar.item, event) : undefined
                    }
                  />
                </EventPeekPopover>
              ))}
          </div>
        </div>
        {hiddenAllDayCount > 0 || allDayExpanded ? (
          <div className="flex border-b border-border">
            <div className={cn(GUTTER_CLASS, 'border-e border-border')} />
            <div className="flex min-w-0 flex-1 justify-start px-1.5 py-0.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto p-0 text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground hover:underline"
                aria-expanded={allDayExpanded}
                onClick={() => setAllDayExpanded((open) => !open)}
              >
                {allDayExpanded
                  ? t('customers.calendar.grid.showLess', 'Show less')
                  : t('customers.calendar.grid.more', '+{count} more', { count: hiddenAllDayCount })}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Timed region — the only part that scrolls. It takes whatever height the
          page has left, so the calendar fills the viewport instead of the page
          scrolling behind a fixed-height grid. */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div ref={gridRef} className="flex" style={{ height: HOURS_PER_DAY * HOUR_HEIGHT_PX }}>
          <div className={cn(GUTTER_CLASS, 'relative border-e border-border')}>
            {hourLabels.map((label, hour) =>
              hour === 0 ? null : (
                <span
                  key={hour}
                  // Sitting just above its own line is what lets the eye read a
                  // label as belonging to the hour that starts there.
                  className="absolute end-0 w-full -translate-y-1/2 pe-1.5 text-end text-overline leading-none text-muted-foreground md:pe-2"
                  style={{ top: hour * HOUR_HEIGHT_PX }}
                >
                  {label}
                </span>
              ),
            )}
            {/* The current time replaces the nearest hour label on the axis. */}
            {showNowIndicator ? (
              <span
                aria-hidden
                className="absolute end-0 z-20 w-full -translate-y-1/2 bg-surface pe-1.5 text-end text-overline font-semibold leading-none text-status-error-text md:pe-2"
                style={{ top: minutesToPx(nowMinutes) }}
              >
                {nowLabel}
              </span>
            ) : null}
          </div>

          <div
            ref={columnsRef}
            className={cn('relative flex min-w-0 flex-1 touch-none', gesture && 'select-none')}
            onPointerDown={canCreate ? beginCreate : undefined}
          >
            {dayStarts.map((dayStart, dayIndex) => {
              const segments = timedByDay[dayIndex] ?? []
              const today = isSameLocalDay(dayStart, new Date(nowMs))
              const conflictCount = showConflicts
                ? segments.filter((segment) => conflictIds.has(segment.item.id)).length
                : 0
              return (
                <div
                  key={dayStart.getTime()}
                  role="gridcell"
                  aria-colindex={dayIndex + 1}
                  aria-label={formatters.fullDate.format(dayStart)}
                  className={cn(
                    'relative min-w-0 flex-1',
                    dayDividerClass(dayIndex, dayStarts.length),
                    today && 'bg-accent/25',
                  )}
                >
                  {/* Hour rules only — a calendar reads cleaner without the
                      half-hour line, and the 48px hour already halves visibly. */}
                  <div aria-hidden className="pointer-events-none absolute inset-0">
                    {Array.from({ length: HOURS_PER_DAY }, (_, hour) => (
                      <div key={hour} className="border-b border-border/60" style={{ height: HOUR_HEIGHT_PX }} />
                    ))}
                  </div>

                  {canCreate ? <div aria-hidden className="absolute inset-0 cursor-cell" /> : null}

                  {conflictCount > 0 ? <ConflictBadge count={conflictCount} /> : null}

                  <div className="pointer-events-none absolute inset-y-0 inset-x-0 pe-1.5">
                    {segments.map((segment) => {
                      const rawTop = minutesToPx(segment.startMinutes)
                      const rawHeight = minutesToPx(segment.endMinutes - segment.startMinutes)
                      const { insetInlineStart, width } = segmentGeometry(segment)
                      const isDragging = draggingItemId === segment.item.id
                      return (
                        <EventPeekPopover
                          key={segmentKey(segment)}
                          item={segment.item}
                          open={selectedId === segment.item.id}
                          joinUrl={resolveJoinUrl(segment.item.location)}
                          aiSummaries={aiSummaries}
                          canManage={canManage}
                          onOpenChange={(open) => setSelectedId(open ? segment.item.id : null)}
                          onJoin={onJoin}
                          onEdit={onItemClick}
                        >
                          <EventBlock
                            item={segment.item}
                            top={rawTop + BLOCK_VERTICAL_GAP_PX}
                            height={Math.max(MIN_BLOCK_HEIGHT_PX, rawHeight - BLOCK_VERTICAL_GAP_PX * 2)}
                            insetInlineStart={insetInlineStart}
                            width={width}
                            stackIndex={segment.column}
                            continuesBefore={segment.continuesBefore}
                            continuesAfter={segment.continuesAfter}
                            resizable={canManage && Boolean(onReschedule) && !isTaskItem(segment.item)}
                            draggable={canManage && Boolean(onReschedule)}
                            dragging={isDragging}
                            conflicted={showConflicts && conflictIds.has(segment.item.id)}
                            highlighted={highlightItemId === segment.item.id}
                            selected={selectedId === segment.item.id}
                            nowMs={nowMs}
                            onPointerDown={(event) => beginMove(segment.item, event)}
                            onResizeStart={(edge, event) => beginResize(segment.item, edge, event)}
                            onNudge={handleNudge}
                          />
                        </EventPeekPopover>
                      )
                    })}
                  </div>

                  {previewRange && previewRange.dayIndex === dayIndex ? (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-1 z-30 flex flex-col gap-0.5 overflow-hidden rounded border-2 border-primary bg-primary/15 px-1.5 pt-0.5"
                      style={{
                        top: minutesToPx(minutesOfDay(previewRange.start)),
                        height: Math.max(
                          MIN_BLOCK_HEIGHT_PX,
                          minutesToPx((previewRange.end.getTime() - previewRange.start.getTime()) / 60_000),
                        ),
                      }}
                    >
                      <span className="truncate text-xs font-semibold leading-tight text-foreground">
                        {formatTimeRange(locale, previewRange.start, previewRange.end)}
                      </span>
                    </div>
                  ) : null}
                </div>
              )
            })}

            {showNowIndicator && nowIndex >= 0 ? (
              <div
                aria-hidden
                className="pointer-events-none absolute z-40 flex items-center"
                style={{
                  top: minutesToPx(nowMinutes),
                  insetInlineStart: `${(nowIndex / dayStarts.length) * 100}%`,
                  width: `${(1 / dayStarts.length) * 100}%`,
                }}
              >
                <span className="-ms-1 size-2.5 shrink-0 rounded-full bg-status-error-icon" />
                <span className="h-0.5 flex-1 bg-status-error-icon" />
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <span className="sr-only" role="status">
        {t('customers.calendar.grid.nowAnnouncement', 'Current time {time}', { time: nowLabel })}
      </span>
    </div>
  )
}
