"use client"

import * as React from 'react'
import { isSameMonth } from 'date-fns/isSameMonth'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { getVisibleRange } from '../../lib/calendar/range'
import { allItemsForDay, packMonthRowBars, singleDayItemsFor } from '../../lib/calendar/layout'
import { BAR_ROW_GAP_PX, BAR_ROW_HEIGHT_PX, CalendarBar } from './CalendarBar'
import { addCalendarDays, isSameLocalDay, localDayKey } from '../../lib/calendar/time'
import { eventDisplayTitle } from '../../lib/calendar/labels'
import { formatTimeLabel, formatTimeRangeLabel } from '../../lib/calendar/format'
import { toneDotStyle } from '../../lib/calendar/tone'
import { EventPeekPopover } from './EventPeekPopover'
import { resolveJoinUrl } from '../../lib/calendar/mapItem'
import { useNowTick } from './useNowTick'
import type { CalendarItem, MonthGridProps } from './types'

const DAYS_PER_WEEK = 7
/**
 * Rows of content a cell shows before the rest collapse into an overflow, used
 * until the grid has been measured. Once a row reports a real height, capacity
 * comes from that instead — a taller viewport should show more of a busy day,
 * not the same four entries with the rest hidden.
 */
const FALLBACK_ROWS_PER_CELL = 4
const MIN_ROWS_PER_CELL = 1
/** Cell padding plus the date numeral row — the space a bar must clear. */
const CELL_PADDING_PX = 2
const DATE_ROW_HEIGHT_PX = 22
/** Room the "+N more" control needs under the last visible entry. */
const OVERFLOW_ROW_HEIGHT_PX = 16
const ROW_UNIT_PX = BAR_ROW_HEIGHT_PX + BAR_ROW_GAP_PX
const BAR_OVERLAY_TOP_PX = CELL_PADDING_PX + DATE_ROW_HEIGHT_PX

function buildWeeks(anchor: Date): Date[][] {
  const range = getVisibleRange('month', anchor, 0)
  const weeks: Date[][] = []
  let cursor = range.from
  while (cursor.getTime() <= range.to.getTime()) {
    const week: Date[] = []
    for (let dayIndex = 0; dayIndex < DAYS_PER_WEEK; dayIndex += 1) {
      week.push(cursor)
      cursor = addCalendarDays(cursor, 1)
    }
    weeks.push(week)
  }
  return weeks
}

/**
 * How many entry rows fit in a week row of `height` pixels.
 *
 * Returns the fallback until a measurement arrives, so the first paint (and
 * every environment without layout, tests included) behaves exactly as the
 * fixed-capacity grid did.
 */
export function rowsPerCellFor(height: number | null): number {
  if (height === null || !Number.isFinite(height) || height <= 0) return FALLBACK_ROWS_PER_CELL
  const usable = height - CELL_PADDING_PX * 2 - DATE_ROW_HEIGHT_PX - OVERFLOW_ROW_HEIGHT_PX
  return Math.max(MIN_ROWS_PER_CELL, Math.floor(usable / ROW_UNIT_PX))
}

type EntryButtonProps = {
  item: CalendarItem
  label: string
  /** Omit when a popover trigger wraps this button and owns the click. */
  onSelect?: () => void
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
} & Omit<React.ComponentProps<typeof Button>, 'aria-label' | 'style' | 'children' | 'onSelect'>

const EntryButton = React.forwardRef<HTMLButtonElement, EntryButtonProps>(function EntryButton(
  { item, label, onSelect, className, style, children, onClick, ...buttonProps },
  ref,
) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      aria-label={label}
      onClick={(event) => {
        // Keep the click off the day cell, which would otherwise start a create.
        event.stopPropagation()
        onSelect?.()
        onClick?.(event)
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        'h-auto min-w-0 justify-start gap-1.5 px-1.5 py-0 text-start text-xs font-medium leading-none transition-colors',
        item.status === 'canceled' && 'opacity-60 line-through',
        className,
      )}
      style={style}
      {...buttonProps}
    >
      {children}
    </Button>
  )
})

EntryButton.displayName = 'EntryButton'

type EntryDotProps = { item: CalendarItem; nowMs: number }

function EntryDot({ item, nowMs }: EntryDotProps) {
  return (
    <span aria-hidden className="flex size-2 shrink-0 items-center justify-center">
      <span
        className={cn('size-2 rounded-full', !item.color && 'bg-primary')}
        style={toneDotStyle(item, nowMs)}
      />
    </span>
  )
}

/** A single-cell entry: dot, time, title — the compact form. */
const MonthPill = React.forwardRef<HTMLButtonElement, { item: CalendarItem; nowMs: number }>(
  function MonthPill({ item, nowMs, ...triggerProps }, ref) {
    const t = useT()
    const locale = useLocale()
    const title = eventDisplayTitle(item.title, t('customers.calendar.grid.untitled', 'Untitled'))
    // The card shows the start time only, the way a month cell has room for; the
    // accessible name still carries the full range, shared with the week view.
    const startLabel = formatTimeLabel(locale, item.start)
    const rangeLabel = formatTimeRangeLabel(locale, item.start, item.end)
    return (
      <EntryButton
        ref={ref}
        item={item}
        label={`${title} · ${rangeLabel}`}
        className="w-full rounded hover:bg-muted"
        style={{ height: BAR_ROW_HEIGHT_PX }}
        {...triggerProps}
      >
        <EntryDot item={item} nowMs={nowMs} />
        <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">{startLabel}</span>
        <span className="min-w-0 truncate text-foreground">{title}</span>
      </EntryButton>
    )
  },
)

MonthPill.displayName = 'MonthPill'

export function MonthGrid({
  anchor,
  items,
  canManage = true,
  aiSummaries = false,
  onItemClick,
  onJoin,
  onDayOpen,
  onCreateAt,
}: MonthGridProps) {
  const t = useT()
  const locale = useLocale()
  const nowMs = useNowTick()
  const [openOverflowKey, setOpenOverflowKey] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [rowHeight, setRowHeight] = React.useState<number | null>(null)
  const rowProbeRef = React.useRef<HTMLDivElement | null>(null)

  // Capacity follows the row's real height, so a tall viewport shows more of a
  // busy day instead of hiding it behind the same fixed overflow count.
  React.useEffect(() => {
    const node = rowProbeRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.height ?? 0
      setRowHeight((current) => (current !== null && Math.abs(current - measured) < 1 ? current : measured))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const maxRowsPerCell = React.useMemo(() => rowsPerCellFor(rowHeight), [rowHeight])

  /**
   * Clicking an entry opens the same peek popover the week view uses, so the
   * interaction reads identically across views.
   */
  const withPeek = React.useCallback(
    (item: CalendarItem, trigger: React.ReactElement) => (
      <EventPeekPopover
        item={item}
        open={selectedId === item.id}
        joinUrl={resolveJoinUrl(item.location)}
        aiSummaries={aiSummaries}
        canManage={canManage}
        onOpenChange={(open) => setSelectedId(open ? item.id : null)}
        onJoin={(joined) => onJoin?.(joined)}
        onEdit={onItemClick}
      >
        {trigger}
      </EventPeekPopover>
    ),
    [aiSummaries, canManage, onItemClick, onJoin, selectedId],
  )

  const weeks = React.useMemo(() => buildWeeks(anchor), [anchor])

  // Bars are computed per week row so a span that crosses a week boundary
  // becomes two segments instead of disappearing after its first day.
  const rows = React.useMemo(
    () =>
      weeks.map((week) => {
        const bars = packMonthRowBars(items, week)
        const barRows = bars.reduce((max, bar) => Math.max(max, bar.lane + 1), 0)
        const visibleBarRows = Math.min(barRows, maxRowsPerCell)
        const cells = week.map((day, dayIndex) => {
          const pills = singleDayItemsFor(items, day)
          const hiddenBars = bars.filter(
            (bar) => bar.lane >= visibleBarRows && dayIndex >= bar.startIndex && dayIndex <= bar.endIndex,
          ).length
          const pillCapacity = Math.max(0, maxRowsPerCell - visibleBarRows)
          const visiblePills = pills.slice(0, pillCapacity)
          const hiddenCount = hiddenBars + (pills.length - visiblePills.length)
          return { day, visiblePills, hiddenCount }
        })
        return { week, bars, visibleBarRows, cells }
      }),
    [weeks, items, maxRowsPerCell],
  )

  const weekdayLabels = React.useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' })
    const longFormatter = new Intl.DateTimeFormat(locale, { weekday: 'long' })
    return (weeks[0] ?? []).map((day) => ({
      short: formatter.format(day).toLocaleUpperCase(locale),
      long: longFormatter.format(day),
    }))
  }, [weeks, locale])

  const fullDate = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    [locale],
  )
  // The first day of a month carries its month name, so a row that crosses a
  // boundary says which month it has crossed into without leaving the grid.
  const monthShort = React.useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short' }), [locale])

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border bg-surface"
      role="grid"
      aria-label={new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(anchor)}
      aria-rowcount={weeks.length}
      aria-colcount={DAYS_PER_WEEK}
    >
      <div className="flex h-7 w-full shrink-0 border-b border-border" role="row">
        {weekdayLabels.map((label, index) => (
          <div
            key={label.long}
            role="columnheader"
            aria-colindex={index + 1}
            className="flex min-w-0 flex-1 items-center justify-center"
          >
            <span className="truncate text-overline font-medium uppercase tracking-widest text-muted-foreground">
              <span className="sm:hidden">{label.short.charAt(0)}</span>
              <span className="hidden sm:inline">{label.short}</span>
            </span>
            <span className="sr-only">{label.long}</span>
          </div>
        ))}
      </div>

      {rows.map(({ week, bars, visibleBarRows, cells }, rowIndex) => (
        <div
          key={localDayKey(week[0])}
          ref={rowIndex === 0 ? rowProbeRef : undefined}
          role="row"
          aria-rowindex={rowIndex + 1}
          className="relative flex min-h-20 w-full flex-1 border-b border-border last:border-b-0"
        >
          {cells.map(({ day, visiblePills, hiddenCount }, columnIndex) => {
            const inMonth = isSameMonth(day, anchor)
            const today = isSameLocalDay(day, new Date(nowMs))
            const overflowKey = localDayKey(day)
            const firstOfMonth = day.getDate() === 1
            return (
              <div
                key={overflowKey}
                role="gridcell"
                aria-colindex={columnIndex + 1}
                aria-label={fullDate.format(day)}
                onClick={() => {
                  if (canManage && onCreateAt) onCreateAt(day)
                }}
                className={cn(
                  'relative flex min-w-0 flex-1 flex-col gap-px overflow-hidden border-e border-border p-0.5 text-left last:border-e-0',
                  // Out-of-month cells recede rather than disappear — the grid
                  // stays one continuous surface, as a month view should.
                  inMonth ? 'bg-surface' : 'bg-surface-muted/50',
                  canManage && onCreateAt && 'cursor-pointer hover:bg-muted/30',
                )}
              >
                <div className="flex shrink-0 items-center justify-center" style={{ height: DATE_ROW_HEIGHT_PX }}>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={t('customers.calendar.grid.openDay', 'Open {date}', {
                      date: fullDate.format(day),
                    })}
                    onClick={(event) => {
                      event.stopPropagation()
                      onDayOpen(day)
                    }}
                    className={cn(
                      'flex h-5 min-w-5 items-center justify-center gap-1 rounded-full px-1.5 text-xs font-medium tabular-nums',
                      today
                        ? 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                        : inMonth
                          ? 'text-foreground hover:bg-muted'
                          : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {firstOfMonth ? <span className="font-normal">{monthShort.format(day)}</span> : null}
                    {day.getDate()}
                  </Button>
                </div>

                {/* Space reserved for the row's spanning bars, which are drawn
                    in the overlay below so one entry stays one element. */}
                <div
                  aria-hidden
                  className="shrink-0"
                  style={{ height: visibleBarRows * ROW_UNIT_PX }}
                />

                <div className="flex min-h-0 flex-col gap-px">
                  {visiblePills.map((item) => (
                    <React.Fragment key={item.id}>
                      {withPeek(item, <MonthPill item={item} nowMs={nowMs} />)}
                    </React.Fragment>
                  ))}
                </div>

                {hiddenCount > 0 ? (
                  <Popover
                    open={openOverflowKey === overflowKey}
                    onOpenChange={(open) => setOpenOverflowKey(open ? overflowKey : null)}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto shrink-0 justify-start self-stretch px-1.5 py-0 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        {t('customers.calendar.grid.more', '+{count} more', { count: hiddenCount })}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" collisionPadding={12} className="w-64 p-2">
                      <p className="px-1 pb-1 text-xs font-semibold text-foreground">{fullDate.format(day)}</p>
                      <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
                        {allItemsForDay(items, day).map((item) => {
                          const title = eventDisplayTitle(
                            item.title,
                            t('customers.calendar.grid.untitled', 'Untitled'),
                          )
                          const timeLabel = item.allDay
                            ? t('customers.calendar.grid.allDay', 'All day')
                            : formatTimeRangeLabel(locale, item.start, item.end)
                          return (
                            <EntryButton
                              key={item.id}
                              item={item}
                              label={`${title} · ${timeLabel}`}
                              onSelect={() => {
                                setOpenOverflowKey(null)
                                onItemClick(item)
                              }}
                              className="w-full rounded py-1.5 hover:bg-muted"
                            >
                              <EntryDot item={item} nowMs={nowMs} />
                              <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
                                {timeLabel}
                              </span>
                              <span className="min-w-0 truncate text-foreground">{title}</span>
                            </EntryButton>
                          )
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : null}
              </div>
            )
          })}

          {/* Spanning bars for this week row. Positioned across the whole row so
              a multi-day entry renders once, continuously. The offset clears the
              date numeral each cell reserves above its content. */}
          <div className="pointer-events-none absolute inset-x-0" style={{ top: BAR_OVERLAY_TOP_PX }}>
            {bars
              .filter((bar) => bar.lane < visibleBarRows)
              .map((bar) => {
                const title = eventDisplayTitle(
                  bar.item.title,
                  t('customers.calendar.grid.untitled', 'Untitled'),
                )
                return (
                  <React.Fragment key={`${bar.item.id}-${localDayKey(week[bar.startIndex])}`}>
                    {withPeek(
                      bar.item,
                      <CalendarBar
                        bar={bar}
                        dayCount={DAYS_PER_WEEK}
                        label={`${title} · ${
                          bar.item.allDay
                            ? t('customers.calendar.grid.allDay', 'All day')
                            : formatTimeRangeLabel(locale, bar.item.start, bar.item.end)
                        }`}
                        className="pointer-events-auto"
                        selected={selectedId === bar.item.id}
                        onPointerDown={(event) => event.stopPropagation()}
                        nowMs={nowMs}
                      />,
                    )}
                  </React.Fragment>
                )
              })}
          </div>
        </div>
      ))}
    </div>
  )
}
