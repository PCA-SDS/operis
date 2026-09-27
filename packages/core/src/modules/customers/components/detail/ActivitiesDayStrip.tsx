'use client'

import * as React from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { toZonedTime } from 'date-fns-tz'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { ButtonGroup } from '@open-mercato/ui/primitives/button-group'
import { Calendar } from '@open-mercato/ui/primitives/calendar'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { useOptionalLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { InteractionSummary } from './types'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

interface ActivitiesDayStripProps {
  entityId: string
  selectedDate: Date
  onSelectDate: (date: Date) => void
  refreshKey?: number
  /**
   * Optional pre-fetched events. When provided, the day strip skips its own fetch
   * and uses the supplied list, ensuring its busyness count agrees with the
   * activity list rendered alongside it (issue #1809 — E1 status filter alignment).
   */
  events?: InteractionSummary[]
  /** Drawn right after the month title, e.g. an overdue count. */
  titleAdornment?: React.ReactNode
  /** Drawn at the end of the header row, after the week navigation. */
  actions?: React.ReactNode
}

const USER_TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()

// Project a UTC ISO timestamp to the user's local timezone before comparing
// "same day" (issue #1809 — E3). The browser's `new Date(iso)` treats the
// instant correctly, but `getDate()/getMonth()/getFullYear()` reflect the
// user's local day, so for activities scheduled at e.g. 23:30 local on a UTC
// boundary the day-strip and list now agree.
function toLocalZonedDate(value: string | Date): Date {
  return toZonedTime(value, USER_TIMEZONE)
}

const DAYS_IN_WEEK = 7
/** Weeks start on Monday, as they do in the customers calendar. */
const WEEK_STARTS_ON = 1
/** Dots under a day stop at three; the day's label carries the exact count. */
const MAX_DOTS = 3

function startOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

function addDays(date: Date, delta: number): Date {
  const next = new Date(date)
  next.setDate(date.getDate() + delta)
  return next
}

function startOfWeek(date: Date): Date {
  const day = startOfDay(date)
  const offset = (day.getDay() - WEEK_STARTS_ON + DAYS_IN_WEEK) % DAYS_IN_WEEK
  return addDays(day, -offset)
}

function buildWeek(weekStart: Date): Date[] {
  return Array.from({ length: DAYS_IN_WEEK }, (_, index) => addDays(weekStart, index))
}

type DayBusyness = {
  totalMinutes: number
  eventCount: number
  /** Two of the day's events overlap in time. */
  conflict: boolean
}

function computeDayBusyness(events: InteractionSummary[], day: Date): DayBusyness {
  const spans: Array<[number, number]> = []
  let totalMinutes = 0
  for (const event of events) {
    const startIso = event.scheduledAt ?? event.occurredAt ?? event.createdAt
    if (!startIso) continue
    const start = new Date(startIso)
    if (Number.isNaN(start.getTime())) continue
    // Compare in the user's local timezone so an activity at 23:30 local time
    // doesn't bleed into the next UTC day's chip (issue #1809 — E3).
    if (!isSameDay(toLocalZonedDate(startIso), day)) continue
    const durationMinutes = typeof event.duration === 'number' && event.duration > 0 ? event.duration : 30
    totalMinutes += durationMinutes
    spans.push([start.getTime(), start.getTime() + durationMinutes * 60000])
  }
  spans.sort((left, right) => left[0] - right[0])
  const conflict = spans.some((span, index) => index > 0 && span[0] < spans[index - 1][1])
  return { totalMinutes, eventCount: spans.length, conflict }
}

function formatBusyLabel(busy: DayBusyness, t: TranslateFn): string {
  if (busy.eventCount === 0) return ''
  const durationLabel = busy.totalMinutes < 60
    ? t('customers.activities.calendar.minutesShort', '{minutes}m', { minutes: Math.max(Math.round(busy.totalMinutes), 1) })
    : t('customers.activities.calendar.hoursShort', '{hours}h', { hours: Math.floor(busy.totalMinutes / 60) })
  return t('customers.activities.calendar.eventsSummary', '{count} {countLabel} · {duration}', {
    count: busy.eventCount,
    countLabel: busy.eventCount === 1
      ? t('customers.activities.calendar.eventSingular', 'event')
      : t('customers.activities.calendar.eventPlural', 'events'),
    duration: durationLabel,
  })
}

/**
 * The Schedule card's calendar: a Monday-to-Sunday week of days, as in Apple
 * Calendar's week header. Each day is its weekday over its date, the date in
 * a filled circle when selected (in accent ink when it is today), with up to
 * three dots for its events, red when two of them overlap. One header row
 * holds the month (a button that opens a month picker), the week navigation
 * and whatever the host adds, so there is one set of arrows.
 */
export function ActivitiesDayStrip({
  entityId,
  selectedDate,
  onSelectDate,
  refreshKey = 0,
  events: providedEvents,
  titleAdornment,
  actions,
}: ActivitiesDayStripProps) {
  const t = useT()
  const locale = useOptionalLocale()
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [fetchedEvents, setFetchedEvents] = React.useState<InteractionSummary[]>([])
  // When the parent supplies `events` (preferred path — keeps day strip and
  // the list in lockstep, fixes #1809 E1), skip the local fetch entirely.
  const useProvidedEvents = providedEvents !== undefined
  const events = useProvidedEvents ? providedEvents : fetchedEvents

  // The week is always the selected day's, so the day under the strip is
  // always one of the seven in it.
  const weekStartTime = startOfWeek(selectedDate).getTime()
  const week = React.useMemo(() => buildWeek(new Date(weekStartTime)), [weekStartTime])

  const formatters = React.useMemo(() => ({
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
    dayNumber: new Intl.DateTimeFormat(locale, { day: 'numeric' }),
    fullDate: new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
    monthYear: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
  }), [locale])

  // The week is named for the month most of it falls in: its Thursday's.
  const monthLabel = formatters.monthYear.format(week[3])

  React.useEffect(() => {
    if (useProvidedEvents) return
    if (!entityId || week.length === 0) return
    const controller = new AbortController()
    const params = new URLSearchParams({
      entityId,
      from: startOfDay(week[0]).toISOString(),
      to: endOfDay(week[week.length - 1]).toISOString(),
      limit: '100',
      sortField: 'scheduledAt',
      sortDir: 'asc',
      excludeInteractionType: 'task',
    })
    void (async () => {
      try {
        const payload = await readApiResultOrThrow<{ items?: InteractionSummary[] }>(
          `/api/customers/interactions?${params.toString()}`,
          { signal: controller.signal },
        )
        setFetchedEvents(Array.isArray(payload?.items) ? payload.items : [])
      } catch (err) {
        if ((err as { name?: string } | null)?.name === 'AbortError') return
        logger.warn('failed to load interactions', { component: 'ActivitiesDayStrip', err })
        setFetchedEvents([])
      }
    })()
    return () => controller.abort()
  }, [entityId, week, refreshKey, useProvidedEvents])

  const todayDate = React.useMemo(() => startOfDay(new Date()), [])

  // Moving a week carries the selection with it, as Apple Calendar does, so
  // the list under the strip keeps describing a day that is on screen.
  const showWeek = React.useCallback((delta: number) => {
    onSelectDate(addDays(startOfDay(selectedDate), delta * DAYS_IN_WEEK))
  }, [onSelectDate, selectedDate])

  const handleToday = React.useCallback(() => {
    onSelectDate(startOfDay(new Date()))
  }, [onSelectDate])

  return (
    <div className="flex flex-col gap-3">
      {/* The month keeps room for its name (`basis-48`), so on a narrow card
          the week controls wrap under it rather than squeezing it. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-48 items-center gap-2">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="-ml-2 min-w-0 gap-1 px-2 text-base font-semibold text-foreground hover:text-foreground"
                aria-label={t('customers.activities.calendar.pickDate', 'Choose a date, {{month}}', { month: monthLabel })}
              >
                <span className="truncate">{monthLabel}</span>
                <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-3">
              <Calendar
                mode="single"
                selected={selectedDate}
                defaultMonth={selectedDate}
                weekStartsOn={WEEK_STARTS_ON}
                onSelect={(date) => {
                  if (!date) return
                  onSelectDate(startOfDay(date))
                  setPickerOpen(false)
                }}
              />
            </PopoverContent>
          </Popover>
          {titleAdornment}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ButtonGroup aria-label={t('customers.activities.calendar.weekNavigation', 'Week')}>
            <IconButton
              type="button"
              variant="soft"
              size="lg"
              onClick={() => showWeek(-1)}
              aria-label={t('customers.calendar.previousWeek', 'Previous week')}
            >
              <ChevronLeft className="size-4" />
            </IconButton>
            <Button type="button" variant="soft" onClick={handleToday}>
              {t('customers.calendar.toolbar.today', 'Today')}
            </Button>
            <IconButton
              type="button"
              variant="soft"
              size="lg"
              onClick={() => showWeek(1)}
              aria-label={t('customers.calendar.nextWeek', 'Next week')}
            >
              <ChevronRight className="size-4" />
            </IconButton>
          </ButtonGroup>
          {actions}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1" role="group" aria-label={monthLabel}>
        {week.map((day) => {
          const busy = computeDayBusyness(events, day)
          const busyLabel = formatBusyLabel(busy, t)
          const fullDate = formatters.fullDate.format(day)
          return (
            <DayCell
              key={day.toISOString()}
              weekday={formatters.weekday.format(day)}
              dayNumber={formatters.dayNumber.format(day)}
              label={busyLabel ? `${fullDate}, ${busyLabel}` : fullDate}
              isSelected={isSameDay(day, selectedDate)}
              isToday={isSameDay(day, todayDate)}
              isWeekend={isWeekend(day)}
              busy={busy}
              onSelect={() => onSelectDate(day)}
            />
          )
        })}
      </div>
    </div>
  )
}

interface DayCellProps {
  weekday: string
  dayNumber: string
  label: string
  isSelected: boolean
  isToday: boolean
  isWeekend: boolean
  busy: DayBusyness
  onSelect: () => void
}

function DayCell({ weekday, dayNumber, label, isSelected, isToday, isWeekend, busy, onSelect }: DayCellProps) {
  const dots = Math.min(busy.eventCount, MAX_DOTS)
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onSelect}
      aria-pressed={isSelected}
      aria-current={isToday ? 'date' : undefined}
      aria-label={label}
      title={label}
      className="group h-auto flex-col gap-1 rounded-lg px-0 py-1.5 hover:bg-transparent"
    >
      <span aria-hidden="true" className="text-xs font-medium text-muted-foreground">{weekday}</span>
      <span
        aria-hidden="true"
        className={cn(
          'flex size-9 items-center justify-center rounded-full text-base tabular-nums transition-colors',
          isSelected
            ? 'bg-primary font-semibold text-primary-foreground'
            : isToday
              ? 'font-semibold text-accent-strong group-hover:bg-surface-muted'
              : cn('font-medium group-hover:bg-surface-muted', isWeekend ? 'text-muted-foreground' : 'text-foreground'),
        )}
      >
        {dayNumber}
      </span>
      <span aria-hidden="true" className="flex h-1.5 items-center justify-center gap-0.5">
        {Array.from({ length: dots }, (_, index) => (
          <span
            key={index}
            className={cn('size-1.5 rounded-full', busy.conflict ? 'bg-status-error-icon' : 'bg-muted-foreground')}
          />
        ))}
      </span>
    </Button>
  )
}

export default ActivitiesDayStrip
