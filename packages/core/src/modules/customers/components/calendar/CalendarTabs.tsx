"use client"

import * as React from 'react'
import { Clock, LayoutGrid, List } from 'lucide-react'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CalendarTab, CalendarTabsProps, CalendarView } from './types'

/**
 * The count trails its label inside one text flow — separated by a real space,
 * not a flex gap — so the segment's accessible name stays `"Meetings (3)"` and
 * the two stay on a shared baseline despite the smaller type.
 */
function ScopeLabel({ label, count }: { label: string; count: number }) {
  return (
    <>
      {label}{' '}
      <span className="text-xs font-medium text-current opacity-70">({count})</span>
    </>
  )
}

/**
 * Calendar chrome row: the category filter on the left, the Day/Week/Month/Agenda
 * view switcher on the right, and transient status text in the slack between
 * them. The status lives here rather than in a row of its own so it costs no
 * vertical space when absent and shifts nothing when it appears.
 *
 * Both are `SegmentedControl`s. The category filter narrows the items rendered by
 * the single view area rather than swapping content panels, so it is mutually
 * exclusive *view state* — the case the segmented control exists for — and not
 * `Tabs`, which would additionally promise a `tabpanel` per option.
 */
export function CalendarTabs({ tab, counts, view, status, onTabChange, onViewChange }: CalendarTabsProps) {
  const t = useT()

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      {/* The rail scrolls instead of overflowing on narrow viewports. `overflow-x`
          also clips vertically, so the padding/negative-margin pair gives a focused
          item's ring room to draw without moving the rail off the content edge. */}
      <div className="-my-1 min-w-0 max-w-full overflow-x-auto py-1 scrollbar-hide">
        <SegmentedControl
          value={tab}
          onValueChange={(value) => onTabChange(value as CalendarTab)}
          aria-label={t('customers.calendar.tabs.label', 'Calendar category')}
        >
          <SegmentedControlItem value="all" icon={<LayoutGrid className="size-4" />}>
            {t('customers.calendar.tabs.all', 'All Scheduled')}
          </SegmentedControlItem>
          <SegmentedControlItem value="meetings" icon={<List className="size-4" />}>
            <ScopeLabel
              label={t('customers.calendar.tabs.meetings', 'Meetings')}
              count={counts.meetings}
            />
          </SegmentedControlItem>
          <SegmentedControlItem value="events" icon={<Clock className="size-4" />}>
            <ScopeLabel
              label={t('customers.calendar.tabs.events', 'Events')}
              count={counts.events}
            />
          </SegmentedControlItem>
        </SegmentedControl>
      </div>
      {status ? (
        <div className="order-last min-w-0 flex-1 basis-full sm:order-none sm:basis-auto">{status}</div>
      ) : null}
      <SegmentedControl
        value={view}
        onValueChange={(value) => onViewChange(value as CalendarView)}
        aria-label={t('customers.calendar.views.label', 'Calendar view')}
      >
        <SegmentedControlItem value="day">
          {t('customers.calendar.views.day', 'Day')}
        </SegmentedControlItem>
        <SegmentedControlItem value="week">
          {t('customers.calendar.views.week', 'Week')}
        </SegmentedControlItem>
        <SegmentedControlItem value="month">
          {t('customers.calendar.views.month', 'Month')}
        </SegmentedControlItem>
        <SegmentedControlItem value="agenda">
          {t('customers.calendar.views.agenda', 'Agenda')}
        </SegmentedControlItem>
      </SegmentedControl>
    </div>
  )
}
