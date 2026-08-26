"use client"

import * as React from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatHeaderLabel } from '../../lib/calendar/format'
import type { CalendarHeaderProps } from './types'

/**
 * One navigation row: Today, previous/next, the contextual date label, then the
 * create action. The grid no longer carries its own arrows, so there is exactly
 * one place to move through time.
 */
export function CalendarHeader({ view, anchor, range, onPrevious, onNext, onNewEvent }: CalendarHeaderProps) {
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
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b py-4">
      {onPrevious && onNext ? (
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton type="button" variant="ghost" size="sm" aria-label={previousLabel} onClick={onPrevious}>
            <ChevronLeft aria-hidden />
          </IconButton>
          <IconButton type="button" variant="ghost" size="sm" aria-label={nextLabel} onClick={onNext}>
            <ChevronRight aria-hidden />
          </IconButton>
        </div>
      ) : null}
      <h1 className="min-w-0 flex-1 truncate text-xl font-semibold text-foreground" aria-live="polite">
        {title}
      </h1>
      {onNewEvent ? (
        <Button
          type="button"
          onClick={onNewEvent}
          className="shrink-0"
          aria-label={t('customers.calendar.actions.newEvent', 'New event')}
        >
          <Plus aria-hidden="true" />
          <span className="hidden sm:inline">{t('customers.calendar.actions.newEvent', 'New event')}</span>
        </Button>
      ) : null}
    </header>
  )
}
