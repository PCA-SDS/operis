"use client"

import * as React from 'react'
import { ListFilter } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CalendarFiltersValue, CalendarToolbarProps } from './types'

const STATUS_OPTIONS = ['planned', 'done', 'canceled'] as const

const ALL_OPTION = 'all'

const EMPTY_FILTERS: CalendarFiltersValue = { types: [], status: null, ownerUserId: null }

/**
 * Search and filters — the cluster that narrows what the grid shows.
 *
 * It renders inside the navigation bar's trailing slot rather than as a row of
 * its own: none of it changes *when* you are looking at, so none of it earns a
 * band of height above the grid.
 *
 * Search and Filter both stand 36px — see the chrome-height note on
 * `CalendarHeader`, and so does every box control inside the filter popover.
 * Settings is NOT here: it is not a narrowing control, and it sits at the far
 * end of the scope row past the date range. The two exceptions are not choices: `Checkbox` tops out at 20px
 * (`md`), and the count `Badge` is an adornment sitting inside the Filter
 * button rather than a control of its own.
 */
export function CalendarToolbar(props: CalendarToolbarProps) {
  const { search, filters, typeOptions, ownerOptions, onSearchChange, onFiltersChange } = props
  const t = useT()
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const [pendingFilters, setPendingFilters] = React.useState<CalendarFiltersValue>(filters)

  const activeFilterCount =
    filters.types.length + (filters.status ? 1 : 0) + (filters.ownerUserId ? 1 : 0)

  const handleFiltersOpenChange = (open: boolean) => {
    if (open) setPendingFilters(filters)
    setFiltersOpen(open)
  }

  const applyFilters = () => {
    onFiltersChange(pendingFilters)
    setFiltersOpen(false)
  }

  const clearFilters = () => {
    setPendingFilters(EMPTY_FILTERS)
    onFiltersChange(EMPTY_FILTERS)
    setFiltersOpen(false)
  }

  const togglePendingType = (value: string, checked: boolean) => {
    setPendingFilters((current) => ({
      ...current,
      types: checked
        ? [...current.types, value]
        : current.types.filter((entry) => entry !== value),
    }))
  }

  return (
    // No `min-w-0` on either box below, and that is load-bearing. A flex item
    // defaults to `min-width: auto` (its content), and `min-w-0` overrides that
    // to "may shrink to nothing" — which is exactly what happened here: the
    // magnifier and the clear button are `shrink-0`, so once the field held a
    // value the ✕ appeared, the row ran out of room, and the `<input>` was the
    // only thing left that could give. It collapsed to 0px wide, leaving a
    // search box with no search box in it. The floor keeps the field usable and
    // the wrapping parent in `CalendarScopeBar` moves the cluster to its own
    // line instead of crushing it.
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
      <Popover open={filtersOpen} onOpenChange={handleFiltersOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            aria-label={t('customers.calendar.toolbar.filters.label', 'Filter')}
          >
            <ListFilter aria-hidden="true" />
            <span className="hidden xl:inline">
              {t('customers.calendar.toolbar.filters.label', 'Filter')}
            </span>
            {activeFilterCount > 0 ? (
              <Badge variant="secondary" size="sm">
                {activeFilterCount}
              </Badge>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-72 p-3"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              applyFilters()
            }
          }}
        >
          <div className="flex flex-col gap-4">
            {typeOptions.length > 0 ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="pb-1 text-overline font-semibold uppercase tracking-widest text-muted-foreground">
                  {t('customers.calendar.toolbar.filters.types', 'Type')}
                </legend>
                {typeOptions.map((option) => (
                  <CheckboxField
                    key={option.value}
                    label={option.label}
                    checked={pendingFilters.types.includes(option.value)}
                    onCheckedChange={(checked) =>
                      togglePendingType(option.value, checked === true)
                    }
                  />
                ))}
              </fieldset>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <span className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">
                {t('customers.calendar.toolbar.filters.status', 'Status')}
              </span>
              <Select
                value={pendingFilters.status ?? ALL_OPTION}
                onValueChange={(value) =>
                  setPendingFilters((current) => ({
                    ...current,
                    status: value === ALL_OPTION ? null : value,
                  }))
                }
              >
                <SelectTrigger
                  aria-label={t('customers.calendar.toolbar.filters.status', 'Status')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_OPTION}>
                    {t('customers.calendar.toolbar.filters.allStatuses', 'All statuses')}
                  </SelectItem>
                  {STATUS_OPTIONS.map((status) => (
                    <SelectItem key={status} value={status}>
                      {t(`customers.calendar.toolbar.filters.statuses.${status}`, status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {ownerOptions.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">
                  {t('customers.calendar.toolbar.filters.owner', 'Owner')}
                </span>
                <Select
                  value={pendingFilters.ownerUserId ?? ALL_OPTION}
                  onValueChange={(value) =>
                    setPendingFilters((current) => ({
                      ...current,
                      ownerUserId: value === ALL_OPTION ? null : value,
                    }))
                  }
                >
                  <SelectTrigger
                    aria-label={t('customers.calendar.toolbar.filters.owner', 'Owner')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_OPTION}>
                      {t('customers.calendar.toolbar.filters.allOwners', 'All owners')}
                    </SelectItem>
                    {ownerOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="flex items-center justify-end gap-2 border-t pt-3">
              <Button type="button" variant="ghost" onClick={clearFilters}>
                {t('customers.calendar.toolbar.filters.clear', 'Clear')}
              </Button>
              <Button type="button" onClick={applyFilters}>
                {t('customers.calendar.toolbar.filters.apply', 'Apply')}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
