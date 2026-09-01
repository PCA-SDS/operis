"use client"

import * as React from 'react'
import { ChevronLeft, ChevronRight, Keyboard, ListChecks, Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatHeaderLabel } from '../../lib/calendar/format'
import type { CalendarHeaderProps, CalendarView } from './types'

/**
 * The calendar's navigation bar.
 *
 * Only the controls that move you through time or change the shape of the view
 * live here — Today, the arrows, the date they resolve to, the view switcher,
 * and the create action. Search and filters narrow *what* is shown rather than
 * *when*, so they sit on the scope row below; keeping them off this row is also
 * what stops the date label — the one fact the whole grid is answering — from
 * being squeezed into an ellipsis at ordinary window widths.
 */
export function CalendarHeader({
  view,
  anchor,
  range,
  onPrevious,
  onNext,
  onToday,
  onViewChange,
  onNewEvent,
  onNewTask,
  onOpenShortcuts,
}: CalendarHeaderProps) {
  const t = useT()
  const locale = useLocale()

  const title = React.useMemo(() => {
    if (view === 'agenda') return t('customers.calendar.header.titleAgenda', 'Upcoming')
    return formatHeaderLabel(locale, view, anchor, range)
  }, [view, anchor, range, locale, t])

  const previousLabel =
    view === 'month'
      ? t('customers.calendar.header.previousMonth', 'Previous month')
      : view === 'day'
        ? t('customers.calendar.grid.previousDay', 'Previous day')
        : t('customers.calendar.previousWeek', 'Previous week')
  const nextLabel =
    view === 'month'
      ? t('customers.calendar.header.nextMonth', 'Next month')
      : view === 'day'
        ? t('customers.calendar.grid.nextDay', 'Next day')
        : t('customers.calendar.nextWeek', 'Next week')

  return (
    <header className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-3">
      {onToday ? (
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onToday}>
          {t('customers.calendar.toolbar.today', 'Today')}
        </Button>
      ) : null}
      {onPrevious && onNext ? (
        <div className="flex shrink-0 items-center">
          <IconButton type="button" variant="ghost" size="sm" aria-label={previousLabel} onClick={onPrevious}>
            <ChevronLeft aria-hidden />
          </IconButton>
          <IconButton type="button" variant="ghost" size="sm" aria-label={nextLabel} onClick={onNext}>
            <ChevronRight aria-hidden />
          </IconButton>
        </div>
      ) : null}
      {/* Light weight, generous size: the date is the largest thing on the bar
          because it is the one fact the whole grid is answering. */}
      <h1
        className="min-w-0 flex-1 truncate text-lg font-normal leading-tight text-foreground sm:text-xl"
        aria-live="polite"
      >
        {title}
      </h1>
      {onViewChange ? (
        <SegmentedControl
          value={view}
          size="sm"
          className="shrink-0"
          onValueChange={(value) => onViewChange(value as CalendarView)}
          aria-label={t('customers.calendar.views.label', 'Calendar view')}
        >
          <SegmentedControlItem value="day">{t('customers.calendar.views.day', 'Day')}</SegmentedControlItem>
          <SegmentedControlItem value="week">{t('customers.calendar.views.week', 'Week')}</SegmentedControlItem>
          <SegmentedControlItem value="month">{t('customers.calendar.views.month', 'Month')}</SegmentedControlItem>
          <SegmentedControlItem value="agenda">{t('customers.calendar.views.agenda', 'Agenda')}</SegmentedControlItem>
        </SegmentedControl>
      ) : null}
      {onOpenShortcuts ? (
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          className="hidden shrink-0 md:inline-flex"
          aria-label={t('customers.calendar.shortcuts.title', 'Keyboard shortcuts')}
          onClick={onOpenShortcuts}
        >
          <Keyboard aria-hidden />
        </IconButton>
      ) : null}
      {onNewTask ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onNewTask}
          className="shrink-0"
          aria-label={t('customers.calendar.actions.newTask', 'New task')}
        >
          <ListChecks aria-hidden="true" />
          <span className="hidden xl:inline">{t('customers.calendar.actions.newTask', 'New task')}</span>
        </Button>
      ) : null}
      {onNewEvent ? (
        <Button
          type="button"
          size="sm"
          onClick={onNewEvent}
          className="shrink-0"
          aria-label={t('customers.calendar.actions.newEvent', 'New event')}
        >
          <Plus aria-hidden="true" />
          <span className="hidden lg:inline">{t('customers.calendar.actions.newEvent', 'New event')}</span>
        </Button>
      ) : null}
    </header>
  )
}
