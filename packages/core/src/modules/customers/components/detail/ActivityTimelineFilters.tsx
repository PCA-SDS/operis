'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { ActivityFilterPopover, type ActivityTypeCounts } from './ActivityHistoryParts'

type InteractionCounts = {
  call: number
  email: number
  meeting: number
  note: number
  task: number
  total: number
}

type InteractionCountsResponse = {
  ok?: boolean
  result?: InteractionCounts
} & Partial<InteractionCounts>

interface ActivityTimelineFiltersProps {
  entityId: string | null
  activeTypes: string[]
  dateFrom: string
  dateTo: string
  onTypesChange: (types: string[]) => void
  onDateFromChange: (value: string) => void
  onDateToChange: (value: string) => void
  onReset: () => void
}

function parseDateOnly(value: string): Date | null {
  if (!value) return null
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10))
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function toDateOnly(value: Date | null): string {
  if (!value) return ''
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

/**
 * The interaction history's Filter button: which types to show (with their
 * counts for this record) and an optional date range, behind one control.
 */
export function ActivityTimelineFilters({
  entityId,
  activeTypes,
  dateFrom,
  dateTo,
  onTypesChange,
  onDateFromChange,
  onDateToChange,
  onReset,
}: ActivityTimelineFiltersProps) {
  const t = useT()
  const hasActiveFilters = activeTypes.length > 0 || Boolean(dateFrom) || Boolean(dateTo)
  const [counts, setCounts] = React.useState<ActivityTypeCounts | null>(null)

  React.useEffect(() => {
    if (!entityId) return
    const controller = new AbortController()
    void (async () => {
      try {
        const payload = await readApiResultOrThrow<InteractionCountsResponse>(
          `/api/customers/interactions/counts?entityId=${encodeURIComponent(entityId)}`,
          { signal: controller.signal },
        )
        // Endpoint envelope is `{ ok, result: {...counts} }`. Some legacy fixtures
        // return the counts at the top level — fall back to that shape so the
        // counts keep working in either case.
        const source = (payload.result ?? payload) as Partial<InteractionCounts>
        setCounts({
          call: source.call ?? 0,
          email: source.email ?? 0,
          meeting: source.meeting ?? 0,
          note: source.note ?? 0,
          task: source.task ?? 0,
        })
      } catch {
        setCounts(null)
      }
    })()
    return () => controller.abort()
  }, [entityId])

  return (
    <ActivityFilterPopover
      activeTypes={activeTypes}
      onTypesChange={onTypesChange}
      counts={counts}
      active={hasActiveFilters}
      onReset={onReset}
    >
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          {t('customers.activities.filters.dateRange', 'Date range')}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <DatePicker
            value={parseDateOnly(dateFrom)}
            onChange={(next) => onDateFromChange(toDateOnly(next))}
            footer="none"
            placeholder={t('customers.timeline.filter.from', 'From date')}
            aria-label={t('customers.timeline.filter.from', 'From date')}
          />
          <DatePicker
            value={parseDateOnly(dateTo)}
            onChange={(next) => onDateToChange(toDateOnly(next))}
            footer="none"
            align="end"
            placeholder={t('customers.timeline.filter.to', 'To date')}
            aria-label={t('customers.timeline.filter.to', 'To date')}
          />
        </div>
      </div>
    </ActivityFilterPopover>
  )
}
