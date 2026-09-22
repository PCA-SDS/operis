"use client"

import * as React from 'react'
import { ChevronLeft, ChevronRight, ListChecks, Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatHeaderLabel } from '../../lib/calendar/format'
import type { CalendarHeaderProps, CalendarView } from './types'
import { cn } from '@open-mercato/shared/lib/utils'
import { CHROME_BARE_ICON, CHROME_FLAT_CONTROL, CHROME_SEGMENTED_ITEM, CHROME_SEGMENTED_TRACK } from './chrome'

/**
 * The calendar's navigation bar.
 *
 * Only the controls that move you through time or change the shape of the view
 * live here — Today, the arrows, the date they resolve to, the view switcher,
 * and the create action. Search and filters narrow *what* is shown rather than
 * *when*, so they sit on the scope row below; keeping them off this row is also
 * what stops the date label — the one fact the whole grid is answering — from
 * being squeezed into an ellipsis at ordinary window widths.
 *
 * **Borders and shadows.** Every ACTION on this bar is borderless and
 * shadowless. `outline` stripped of its hairline and lift carries Today and
 * New task, `IconButton`'s `white` carries the arrows, New event keeps the
 * filled `default`, and the view switcher has its border made transparent.
 * They previously mixed `outline` (hairline + `shadow-sm`) with `ghost`
 * (neither), so controls standing side by side on one row were drawn three
 * different ways.
 *
 * Fill is what carries the hierarchy now that the borders are gone: New event
 * is filled; Today, New task and the view switcher are raised white
 * (`bg-surface`); and the two date arrows are bare glyphs with no fill in any
 * state. One filled rank for the primary action, one raised rank for the
 * controls, and no paint at all for the pair that is really punctuation around
 * the date. No lines anywhere. `bg-surface`
 * and never `bg-background`: background is the PAGE GROUND, and painting a
 * control with it renders a grey block on a white bar.
 *
 * **Ink.** Every label on both chrome rows is `--foreground` (#1D2735), the
 * near-black. The variants disagree about resting ink — `Button`'s `outline`
 * already inks `text-foreground` while `IconButton`'s `white` inks
 * `text-muted-foreground` — so the icon buttons carry the override and the
 * text buttons do not. `IconButton`'s `ghost` sets no rest colour at all and
 * simply inherits, which is why the scope row's settings button needs nothing.
 *
 * Two labels are deliberately NOT near-black, because both sit on a saturated
 * fill and would be unreadable: New event (`text-primary-foreground` on navy)
 * and the segmented control's SELECTED item (`text-sidebar-foreground` on the
 * navy pill). Those are inversions, not exceptions to the rule.
 *
 * The switcher keeps `border` and only sets `border-transparent`, never
 * `border-0`: the track's geometry is `h-9 − 2px border − 8px padding`, so
 * dropping the width would move the selected pill's inset rather than just
 * hide the line.
 *
 * INPUTS are deliberately exempt — the scope row's range picker and preset
 * select keep their hairline, because a border is what marks a control as
 * editable. The rule is "actions lose their border", not "the chrome does".
 *
 * **Chrome height.** Every control across both chrome rows — this bar and the
 * scope row below it — stands 36px tall, with no exception. The primitives
 * disagree about what their size names mean (`sm` is 36px on nothing, 32px on
 * `Button`/`SegmentedControl`/`SearchInput`/`Select` and 28px on `IconButton`),
 * so the rule is stated as a height rather than as a prop: take each
 * primitive's `default`, and give `IconButton` `lg`, whose scale sits one step
 * below `Button`'s. `CalendarHeader.test.tsx` and `CalendarToolbar.test.tsx`
 * hold the row to it.
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
        <Button type="button" variant="outline" className={cn("shrink-0", CHROME_FLAT_CONTROL)} onClick={onToday}>
          {t('customers.calendar.toolbar.today', 'Today')}
        </Button>
      ) : null}
      {/* Every control on this bar is 36px tall — see the chrome-height note
          in the component docblock. That means each primitive's own `default`,
          except `IconButton`, whose scale is one step down from `Button`'s and
          needs `lg` to reach the same box.

          The arrows flank the date rather than sitting in a pair beside it, so
          "back" and "forward" point at the thing they move — the same shape
          ScheduleToolbar uses. They are also the one UNPAINTED control on the
          bar: bare glyphs with no fill at rest and none on hover, because a
          chevron either side of a heading is punctuation for it, and two filled
          boxes hugging a date read as controls competing with it.

          `flex-1` lives on this group, not on the title: the group absorbs the
          slack, which both keeps the next arrow tight against the date and
          pushes the create actions to the far end of the row. */}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {onPrevious && onNext ? (
          <IconButton
            type="button"
            variant="ghost"
            size="lg"
            className={CHROME_BARE_ICON}
            aria-label={previousLabel}
            onClick={onPrevious}
          >
            <ChevronLeft aria-hidden />
          </IconButton>
        ) : null}
        {/* Light weight, generous size: the date is the largest thing on the bar
            because it is the one fact the whole grid is answering. */}
        <h1
          className="min-w-0 truncate text-lg font-normal leading-tight text-foreground sm:text-xl"
          aria-live="polite"
        >
          {title}
        </h1>
        {onPrevious && onNext ? (
          <IconButton
            type="button"
            variant="ghost"
            size="lg"
            className={CHROME_BARE_ICON}
            aria-label={nextLabel}
            onClick={onNext}
          >
            <ChevronRight aria-hidden />
          </IconButton>
        ) : null}
      </div>
      {/* Create actions lead the cluster, then the view switcher, then the
          shortcuts affordance. The create buttons are the only things on this
          bar that add something rather than re-frame what is already there, so
          they are what the eye should land on first; the view switcher and the
          keyboard hint are both re-framing controls and read as one group
          behind them. `onNewEvent` is permission-gated (`canManage` in
          CalendarScreen), so on a read-only account the row collapses to
          New task -> views. The two create actions stay adjacent
          in every case — splitting them around the switcher would read as two
          unrelated buttons rather than one create affordance. */}
      {onNewTask ? (
        /* The one raised action on the row: `outline` for its white `bg-surface`
           fill and full-ink label, with the hairline and lift turned off so it
           still matches the borderless treatment. `bg-surface`, never
           `bg-background` — background is the page ground, and painting a
           control with it renders a grey block on a white bar. */
        <Button
          type="button"
          variant="outline"
          onClick={onNewTask}
          className={cn("shrink-0", CHROME_FLAT_CONTROL)}
          aria-label={t('customers.calendar.actions.newTask', 'New task')}
        >
          <ListChecks aria-hidden="true" />
          <span className="hidden xl:inline">{t('customers.calendar.actions.newTask', 'New task')}</span>
        </Button>
      ) : null}
      {onNewEvent ? (
        <Button
          type="button"
          onClick={onNewEvent}
          className="shrink-0"
          aria-label={t('customers.calendar.actions.newEvent', 'New event')}
        >
          <Plus aria-hidden="true" />
          <span className="hidden lg:inline">{t('customers.calendar.actions.newEvent', 'New event')}</span>
        </Button>
      ) : null}
      {onViewChange ? (
        <SegmentedControl
          value={view}
          className={cn("shrink-0", CHROME_SEGMENTED_TRACK)}
          onValueChange={(value) => onViewChange(value as CalendarView)}
          aria-label={t('customers.calendar.views.label', 'Calendar view')}
        >
          <SegmentedControlItem className={CHROME_SEGMENTED_ITEM} value="day">{t('customers.calendar.views.day', 'Day')}</SegmentedControlItem>
          <SegmentedControlItem className={CHROME_SEGMENTED_ITEM} value="week">{t('customers.calendar.views.week', 'Week')}</SegmentedControlItem>
          <SegmentedControlItem className={CHROME_SEGMENTED_ITEM} value="month">{t('customers.calendar.views.month', 'Month')}</SegmentedControlItem>
          <SegmentedControlItem className={CHROME_SEGMENTED_ITEM} value="agenda">{t('customers.calendar.views.agenda', 'Agenda')}</SegmentedControlItem>
        </SegmentedControl>
      ) : null}
    </header>
  )
}
