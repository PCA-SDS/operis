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
import { EventPeekPopover } from './EventPeekPopover'
import { resolveJoinUrl } from '../../lib/calendar/mapItem'
import { useNowTick } from './useNowTick'
import type { CalendarItem, MonthGridProps } from './types'

const DAYS_PER_WEEK = 7
/** Rows of content a cell shows before collapsing the rest into an overflow. */
const MAX_ROWS_PER_CELL = 4
/** Cell padding (`p-1`) plus the date numeral row (`size-6`) and its gap — the
 *  vertical space a spanning bar must clear inside a day cell. */
const CELL_PADDING_PX = 4
const DATE_ROW_HEIGHT_PX = 24
const BAR_OVERLAY_TOP_PX = CELL_PADDING_PX + DATE_ROW_HEIGHT_PX + BAR_ROW_GAP_PX

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

function isWeekend(date: Date): boolean {
  const weekday = date.getDay()
  return weekday === 0 || weekday === 6
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
        'h-auto min-w-0 justify-start gap-1 px-1 py-0 text-start text-xs font-medium transition-colors',
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

/** A single-cell entry: dot, time, title — the compact form. */
const MonthPill = React.forwardRef<HTMLButtonElement, { item: CalendarItem }>(function MonthPill(
  { item, ...triggerProps },
  ref,
) {
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
      className="w-full rounded-sm hover:bg-muted"
      style={{ height: BAR_ROW_HEIGHT_PX }}
      {...triggerProps}
    >
      <span aria-hidden className="flex size-2 shrink-0 items-center justify-center">
        <span
          className={cn('size-1.5 rounded-full', !item.color && 'bg-muted-foreground')}
          style={item.color ? { backgroundColor: item.color } : undefined}
        />
      </span>
      <span className="shrink-0 text-overline tabular-nums text-muted-foreground">{startLabel}</span>
      <span className="min-w-0 truncate text-foreground">{title}</span>
    </EntryButton>
  )
})

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
        const visibleBarRows = Math.min(barRows, MAX_ROWS_PER_CELL)
        const cells = week.map((day) => {
          const pills = singleDayItemsFor(items, day)
          const barsHere = bars.filter(
            (bar) =>
              bar.lane < visibleBarRows &&
              week.indexOf(day) >= bar.startIndex &&
              week.indexOf(day) <= bar.endIndex,
          ).length
          const hiddenBars = bars.filter(
            (bar) =>
              bar.lane >= visibleBarRows &&
              week.indexOf(day) >= bar.startIndex &&
              week.indexOf(day) <= bar.endIndex,
          ).length
          const pillCapacity = Math.max(0, MAX_ROWS_PER_CELL - visibleBarRows)
          const visiblePills = pills.slice(0, pillCapacity)
          const hiddenCount = hiddenBars + (pills.length - visiblePills.length)
          return { day, visiblePills, hiddenCount, barsHere }
        })
        return { week, bars, visibleBarRows, cells }
      }),
    [weeks, items],
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

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-surface"
      role="grid"
      aria-label={new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(anchor)}
      aria-rowcount={weeks.length}
      aria-colcount={DAYS_PER_WEEK}
    >
      <div className="flex h-8 w-full shrink-0 border-b border-border" role="row">
        {weekdayLabels.map((label, index) => (
          <div
            key={label.long}
            role="columnheader"
            aria-colindex={index + 1}
            className="flex min-w-0 flex-1 items-center justify-center border-e border-border last:border-e-0 sm:justify-start sm:ps-2"
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
          role="row"
          aria-rowindex={rowIndex + 1}
          className="relative flex min-h-24 w-full flex-1 border-b border-border last:border-b-0"
        >
          {cells.map(({ day, visiblePills, hiddenCount }, columnIndex) => {
            const inMonth = isSameMonth(day, anchor)
            const today = isSameLocalDay(day, new Date(nowMs))
            const overflowKey = localDayKey(day)
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
                  'relative flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden border-e border-border p-1 text-left last:border-e-0',
                  isWeekend(day) ? 'bg-surface-muted/40' : 'bg-surface',
                  canManage && onCreateAt && 'cursor-pointer hover:bg-muted/30',
                )}
              >
                <div className="flex shrink-0 items-center justify-between">
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
                      'flex size-6 items-center justify-center rounded-full p-0 text-xs font-medium',
                      today
                        ? 'bg-primary text-primary-foreground hover:bg-primary'
                        : inMonth
                          ? 'text-foreground'
                          : 'text-muted-foreground',
                    )}
                  >
                    {day.getDate()}
                  </Button>
                </div>

                {/* Space reserved for the row's spanning bars, which are drawn
                    in the overlay below so one entry stays one element. */}
                <div
                  aria-hidden
                  className="shrink-0"
                  style={{ height: visibleBarRows * (BAR_ROW_HEIGHT_PX + BAR_ROW_GAP_PX) }}
                />

                <div className="flex min-h-0 flex-col gap-0.5">
                  {visiblePills.map((item) => (
                    <React.Fragment key={item.id}>{withPeek(item, <MonthPill item={item} />)}</React.Fragment>
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
                        className="h-auto shrink-0 self-start p-0 text-overline font-medium text-muted-foreground hover:bg-transparent hover:underline"
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
                              className="w-full rounded-sm py-1 hover:bg-muted"
                            >
                              <span aria-hidden className="flex size-2 shrink-0 items-center justify-center">
                                <span
                                  className={cn('size-1.5 rounded-full', !item.color && 'bg-muted-foreground')}
                                  style={item.color ? { backgroundColor: item.color } : undefined}
                                />
                              </span>
                              <span className="shrink-0 text-overline tabular-nums text-muted-foreground">
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
