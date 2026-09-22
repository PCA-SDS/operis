"use client"

import * as React from 'react'
import { CalendarRange, Settings } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Calendar } from '@open-mercato/ui/primitives/calendar'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { Separator } from '@open-mercato/ui/primitives/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateRangeLabel } from '../../lib/calendar/format'
import { CalendarTabs } from './CalendarTabs'
import type { CalendarRangePreset, CalendarScopeBarProps } from './types'
import { cn } from '@open-mercato/shared/lib/utils'
import { CHROME_FLAT_CONTROL } from './chrome'

const RANGE_PRESETS: CalendarRangePreset[] = ['thisWeek', 'next7', 'thisMonth', 'next30']

/**
 * The scope row: which categories are in play on the left, which span of dates
 * on the right, and whatever transient status has to be said in between.
 *
 * These are the product's own controls rather than a calendar's, so they sit
 * below the navigation bar in one compact band instead of competing with it.
 *
 * Every control here stands 36px, same as the navigation bar — see the
 * chrome-height note on `CalendarHeader`.
 */
export function CalendarScopeBar({
  tab,
  counts,
  range,
  anchor,
  preset,
  status,
  trailing,
  onTabChange,
  onPresetChange,
  onAnchorChange,
  onOpenSettings,
}: CalendarScopeBarProps) {
  const t = useT()
  const locale = useLocale()
  const [rangeOpen, setRangeOpen] = React.useState(false)

  const presetLabels: Record<CalendarRangePreset, string> = {
    thisWeek: t('customers.calendar.toolbar.presets.thisWeek', 'This week'),
    next7: t('customers.calendar.toolbar.presets.next7', 'Next 7 days'),
    thisMonth: t('customers.calendar.toolbar.presets.thisMonth', 'This month'),
    next30: t('customers.calendar.toolbar.presets.next30', 'Next 30 days'),
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <CalendarTabs tab={tab} counts={counts} onTabChange={onTabChange} />
      {status ? (
        <div className="order-last min-w-0 basis-full lg:order-none lg:basis-auto">{status}</div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
        {trailing}
        <div className="flex min-w-0 shrink-0 items-center">
          <Select value={preset ?? ''} onValueChange={(value) => onPresetChange(value as CalendarRangePreset)}>
            <SelectTrigger
              className={cn("hidden w-auto min-w-32 rounded-r-none sm:flex", CHROME_FLAT_CONTROL)}
              aria-label={t('customers.calendar.toolbar.presetLabel', 'Date range preset')}
            >
              <SelectValue placeholder={t('customers.calendar.toolbar.presetPlaceholder', 'Custom range')} />
            </SelectTrigger>
            <SelectContent>
              {RANGE_PRESETS.map((value) => (
                <SelectItem key={value} value={value}>
                  {presetLabels[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* The preset select and the range trigger are one control split in
              two, and with both of them flat there was no longer anything
              between "This week" and the date it resolves to — the pair read as
              a single run of text. This rule is what puts the seam back without
              reintroducing the two hairlines that used to box them in.

              `hidden sm:block` tracks the select beside it: that is hidden
              below `sm`, and a divider with nothing on its left is just a mark
              floating before the date. */}
          <Separator orientation="vertical" className="hidden h-5 shrink-0 sm:block" />
          <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className={cn("min-w-0 text-foreground sm:rounded-l-none", CHROME_FLAT_CONTROL)}
              >
                <CalendarRange aria-hidden="true" />
                <span className="truncate">{formatDateRangeLabel(locale, range.from, range.to)}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto min-w-0 p-2">
              <Calendar
                mode="single"
                selected={anchor}
                defaultMonth={anchor}
                onSelect={(date) => {
                  if (!date) return
                  onAnchorChange(date)
                  setRangeOpen(false)
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
        {/* Settings closes the row. It is the only control here that does not
            change what the grid shows, so it sits past the date range rather
            than among the narrowing controls. `lg` is the IconButton size that
            stands 36px, the height every control on this row shares.

            `ghost`, matching every other ACTION across both chrome rows — see
            the borders-and-shadows note in CalendarHeader. The preset select
            and the range trigger beside it keep their hairline on purpose:
            they are inputs, and the border is what marks them editable. */}
        <IconButton
          type="button"
          variant="ghost"
          size="lg"
          className="shrink-0"
          aria-label={t('customers.calendar.toolbar.settings', 'Calendar settings')}
          onClick={onOpenSettings}
        >
          <Settings aria-hidden />
        </IconButton>
      </div>
    </div>
  )
}
