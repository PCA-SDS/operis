"use client"

import * as React from 'react'
import { Clock, LayoutGrid, List } from 'lucide-react'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CalendarTab, CalendarTabsProps } from './types'

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
 * The category filter — All Scheduled / Meetings / Events.
 *
 * It narrows the items rendered by the single view area rather than swapping
 * content panels, so it is mutually exclusive *view state* — the case the
 * segmented control exists for — and not `Tabs`, which would additionally
 * promise a `tabpanel` per option. The Day/Week/Month/Agenda switcher lives in
 * the navigation bar, next to the date it is switching the shape of.
 *
 * Left at its `default` size so it stands 36px like everything else on the two
 * chrome rows — see the chrome-height note on `CalendarHeader`.
 */
export function CalendarTabs({ tab, counts, onTabChange }: CalendarTabsProps) {
  const t = useT()

  return (
    // The rail scrolls instead of overflowing on narrow viewports. `overflow-x`
    // also clips vertically, so the padding/negative-margin pair gives a focused
    // item's ring room to draw without moving the rail off the content edge.
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
          <ScopeLabel label={t('customers.calendar.tabs.meetings', 'Meetings')} count={counts.meetings} />
        </SegmentedControlItem>
        <SegmentedControlItem value="events" icon={<Clock className="size-4" />}>
          <ScopeLabel label={t('customers.calendar.tabs.events', 'Events')} count={counts.events} />
        </SegmentedControlItem>
      </SegmentedControl>
    </div>
  )
}
