"use client"

import * as React from 'react'
import { CalendarRange } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Calendar } from '@open-mercato/ui/primitives/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
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

const RANGE_PRESETS: CalendarRangePreset[] = ['thisWeek', 'next7', 'thisMonth', 'next30']

/**
 * The scope row: which categories are in play on the left, which span of dates
 * on the right, and whatever transient status has to be said in between.
 *
 * These are the product's own controls rather than a calendar's, so they sit
 * below the navigation bar in one compact band instead of competing with it.
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
              size="sm"
              className="hidden w-auto min-w-32 rounded-r-none sm:flex"
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
          <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-w-0 text-muted-foreground sm:-ml-px sm:rounded-l-none"
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
      </div>
    </div>
  )
}
