'use client'

import * as React from 'react'
import { Mail, Phone, StickyNote, Users } from 'lucide-react'
import { toZonedTime } from 'date-fns-tz'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { ActivitiesDayStrip } from './ActivitiesDayStrip'
import { ActivitiesAddNewMenu, type ActivityKind } from './ActivitiesAddNewMenu'
import { formatDurationShort } from './ActivityHistoryParts'
import type { InteractionSummary } from './types'
import { isOpenInteractionStatus } from '../../lib/interactionStatus'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

interface ActivitiesCardProps {
  entityId: string
  /**
   * Initial planned activities (from the parent route's `plannedActivitiesPreview`).
   * Used as the seed value before the broader `/api/customers/interactions` fetch
   * resolves, and as the fallback when the fetch fails. The card always prefers
   * its own fetched window (issue #1809 — fixes E1 status alignment and E2 type
   * coverage by sourcing from the same endpoint as the day strip rather than the
   * 5-item server preview that excluded most types in practice).
   */
  plannedActivities: InteractionSummary[]
  refreshKey?: number
  onAddNew: (kind: ActivityKind) => void
  onEditActivity?: (activity: InteractionSummary) => void
  /**
   * Optional company name for the parent entity. When the planned activity has no `dealTitle`,
   * the row subtitle falls back to "{type} · {company}" to mirror Figma 784:809.
   */
  entityCompanyName?: string | null
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: StickyNote,
}

const USER_TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()

// Project a UTC instant to the user's local timezone before extracting day/month/year
// for "same day" comparisons (issue #1809 — E3 timezone drift).
function toLocalZonedDate(value: string | Date): Date {
  return toZonedTime(value, USER_TIMEZONE)
}

function startOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isOverdue(activity: InteractionSummary, now: Date): boolean {
  const scheduled = activity.scheduledAt ?? activity.occurredAt
  if (!scheduled) return false
  const date = new Date(scheduled)
  if (Number.isNaN(date.getTime())) return false
  return date.getTime() < now.getTime() && isOpenInteractionStatus(activity.status)
}

// Days loaded either side of the window's centre for the day strip and the
// list; the centre follows the selected day (see `windowCenter`).
const FETCH_WINDOW_DAYS = 31

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function ActivitiesCard({
  entityId,
  plannedActivities,
  refreshKey = 0,
  onAddNew,
  onEditActivity,
  entityCompanyName,
}: ActivitiesCardProps) {
  const t = useT()
  const [selectedDate, setSelectedDate] = React.useState<Date>(() => startOfDay(new Date()))
  // Fetch the same broader window as the day strip via the canonical interactions
  // endpoint. This single source of truth aligns the day-strip count with the
  // visible event list (issue #1809 — E1) and surfaces all interaction types
  // (issue #1809 — E2: the previous reliance on the server-side 5-item preview
  // produced "Person view shows only Calls" because the limit happened to drop
  // every non-call entry from the prefix-window).
  const [fetchedEvents, setFetchedEvents] = React.useState<InteractionSummary[] | null>(null)
  // The loaded window is centred on today and moves to wherever the reader
  // takes the strip once its week would run past either edge.
  const [windowCenter, setWindowCenter] = React.useState<Date>(() => startOfDay(new Date()))
  React.useEffect(() => {
    const distanceDays = Math.abs(selectedDate.getTime() - windowCenter.getTime()) / 86_400_000
    if (distanceDays > FETCH_WINDOW_DAYS - 7) setWindowCenter(startOfDay(selectedDate))
  }, [selectedDate, windowCenter])

  React.useEffect(() => {
    if (!entityId) {
      setFetchedEvents(null)
      return
    }
    const controller = new AbortController()
    const fromDate = new Date(windowCenter)
    fromDate.setDate(windowCenter.getDate() - FETCH_WINDOW_DAYS)
    const toDate = new Date(windowCenter)
    toDate.setDate(windowCenter.getDate() + FETCH_WINDOW_DAYS)
    toDate.setHours(23, 59, 59, 999)
    const params = new URLSearchParams({
      entityId,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      // Server caps at 100 (interactions querySchema). 100 is well above what
      // an active CRM record accumulates in a 31-day window of meetings/calls,
      // and the day strip + list naturally degrade to truncation if exceeded.
      limit: '100',
      sortField: 'scheduledAt',
      sortDir: 'asc',
      excludeInteractionType: 'task',
    })
    void (async () => {
      try {
        const payload = await readApiResultOrThrow<{ items?: InteractionSummary[] }>(
          `/api/customers/interactions?${params.toString()}`,
          { signal: controller.signal },
        )
        setFetchedEvents(Array.isArray(payload?.items) ? payload.items : [])
      } catch (err) {
        if ((err as { name?: string } | null)?.name !== 'AbortError') {
          logger.warn('failed to load interactions', { component: 'ActivitiesCard', err })
          setFetchedEvents(null)
        }
      }
    })()
    return () => controller.abort()
  }, [entityId, refreshKey, windowCenter])

  // Prefer the broader fetch when it has resolved; fall back to the seed prop
  // (route-supplied preview) only while the fetch is in flight or after a
  // hard failure. This guarantees that the rare prop-only render path keeps
  // backwards-compat with existing unit tests while live UI uses the broader fetch.
  const effectiveEvents: InteractionSummary[] = fetchedEvents ?? plannedActivities

  const eventsForSelectedDay = React.useMemo(() => {
    const items = effectiveEvents.filter((activity) => {
      const scheduled = activity.scheduledAt ?? activity.occurredAt
      if (!scheduled) return false
      const date = new Date(scheduled)
      if (Number.isNaN(date.getTime())) return false
      // Compare in the user's local timezone so a 23:30 local activity stays
      // on its local-day chip instead of bleeding into the next UTC day
      // (issue #1809 — E3).
      return isSameDay(toLocalZonedDate(scheduled), selectedDate)
    })
    return items.sort((left, right) => {
      const leftTime = new Date(left.scheduledAt ?? left.occurredAt ?? left.createdAt).getTime()
      const rightTime = new Date(right.scheduledAt ?? right.occurredAt ?? right.createdAt).getTime()
      return leftTime - rightTime
    })
  }, [effectiveEvents, selectedDate])

  const overdueCount = React.useMemo(() => {
    const now = new Date()
    return effectiveEvents.filter((activity) => isOverdue(activity, now)).length
  }, [effectiveEvents])

  return (
    <section
      aria-label={t('customers.activities.card.title', 'Activities')}
      className="flex flex-col gap-4 rounded-xl border border-card-edge bg-surface p-4 shadow-xs"
    >
      <ActivitiesDayStrip
        entityId={entityId}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        refreshKey={refreshKey}
        events={fetchedEvents ?? undefined}
        titleAdornment={overdueCount > 0 ? (
          <span className="shrink-0 text-sm font-medium text-status-error-text">
            {t('customers.activities.card.overdue', '{count} overdue', { count: overdueCount })}
          </span>
        ) : null}
        actions={<ActivitiesAddNewMenu onSelect={onAddNew} />}
      />

      <div className="border-t border-border pt-3">
        {eventsForSelectedDay.length > 0 ? (
          <ul className="-mx-2 flex flex-col">
            {eventsForSelectedDay.map((activity) => (
              <PlannedEventRow
                key={activity.id}
                activity={activity}
                onClick={onEditActivity}
                entityCompanyName={entityCompanyName ?? null}
                t={t}
              />
            ))}
          </ul>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">
            {t('customers.activities.card.empty', 'Nothing scheduled for this day.')}
          </p>
        )}
      </div>
    </section>
  )
}

interface PlannedEventRowProps {
  activity: InteractionSummary
  onClick?: (activity: InteractionSummary) => void
  entityCompanyName: string | null
  t: TranslateFn
}

function PlannedEventRow({ activity, onClick, entityCompanyName, t }: PlannedEventRowProps) {
  const dateStr = activity.scheduledAt ?? activity.occurredAt ?? activity.createdAt
  const date = new Date(dateStr)
  const validDate = !Number.isNaN(date.getTime())
  const Icon = TYPE_ICONS[activity.interactionType] ?? Users
  const duration = typeof activity.duration === 'number' && activity.duration > 0 ? activity.duration : null
  const overdue = validDate && date.getTime() < Date.now() && isOpenInteractionStatus(activity.status)
  const typeLabel = labelForType(activity.interactionType, t)
  const subtitleSuffix = activity.dealTitle ?? entityCompanyName ?? null
  const subtitle = subtitleSuffix ? `${typeLabel} · ${subtitleSuffix}` : typeLabel
  const content = (
    <>
      <span
        className={cn(
          'w-18 shrink-0 whitespace-nowrap text-sm tabular-nums',
          overdue ? 'font-medium text-status-error-text' : 'text-foreground',
        )}
      >
        {validDate ? formatTime(date) : ''}
      </span>
      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">
          {activity.title ?? activity.body ?? typeLabel}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate">{subtitle}</span>
          {duration ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">{formatDurationShort(duration, t)}</span>
            </>
          ) : null}
        </span>
      </span>
    </>
  )

  return (
    <li>
      {onClick ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => onClick(activity)}
          className="h-auto w-full justify-start gap-3 whitespace-normal rounded-lg px-2 py-2 text-left font-normal hover:bg-surface-muted"
        >
          {content}
        </Button>
      ) : (
        <div className="flex w-full items-center gap-3 px-2 py-2">{content}</div>
      )}
    </li>
  )
}

function labelForType(type: string, t: TranslateFn): string {
  const map: Record<string, [string, string]> = {
    meeting: ['customers.timeline.filter.meeting', 'Meeting'],
    call: ['customers.timeline.filter.call', 'Call'],
    email: ['customers.timeline.filter.email', 'Email'],
    note: ['customers.timeline.filter.note', 'Note'],
    task: ['customers.timeline.filter.task', 'Task'],
  }
  const entry = map[type]
  return entry ? t(entry[0], entry[1]) : type
}

export default ActivitiesCard
