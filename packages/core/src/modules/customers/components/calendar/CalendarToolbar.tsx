"use client"

import * as React from 'react'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CalendarToolbarProps } from './types'

/**
 * Search — the one control left that narrows what the grid shows.
 *
 * This used to be a search field plus a Filter popover (interaction type,
 * status, owner) with a count badge on its trigger. The popover is gone while
 * the calendar is held at its most basic form, so the component is the field
 * and nothing else.
 *
 * The field stands 36px, matching every other control across both chrome rows —
 * see the chrome-height note on `CalendarHeader`. `min-w-40` is a real floor,
 * not a guess: the magnifier and the clear button are `shrink-0`, so once the
 * field held a value the clear button appeared, the row ran out of room, and
 * the `<input>` was the only thing that could give — it collapsed to 0px wide,
 * leaving a search box with no search box in it. The floor keeps the field
 * usable and lets the wrapping parent in `CalendarScopeBar` move the cluster
 * onto its own line instead of crushing it.
 */
export function CalendarToolbar(props: CalendarToolbarProps) {
  const { search, onSearchChange } = props
  const t = useT()

  return (
    <div className="flex flex-1 items-center justify-end gap-2">
      <div className="min-w-40 flex-1 basis-40 sm:max-w-56 lg:max-w-64">
        <SearchInput
          value={search}
          onChange={onSearchChange}
          placeholder={t('customers.calendar.toolbar.searchPlaceholder', 'Search…')}
          aria-label={t('customers.calendar.toolbar.searchPlaceholder', 'Search…')}
          data-calendar-search=""
        />
      </div>
    </div>
  )
}
