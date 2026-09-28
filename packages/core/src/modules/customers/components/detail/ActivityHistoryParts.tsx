'use client'

import * as React from 'react'
import { Check, ListFilter, ListTodo, Mail, Phone, StickyNote, Users } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { MENU_ROW_HOVER } from '@open-mercato/ui/primitives/menu'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import type { InteractionSummary } from './types'
import { isOpenInteractionStatus } from '../../lib/interactionStatus'

export const ACTIVITY_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: StickyNote,
  task: ListTodo,
}

/** The activity types a history can be narrowed to, in the order they are offered. */
export const ACTIVITY_FILTER_TYPES = ['note', 'call', 'meeting', 'email', 'task'] as const

export type ActivityTypeCounts = Partial<Record<string, number>>

const ACTIVITY_TYPE_FALLBACKS: Record<string, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
  task: 'Task',
}

export function activityTypeLabel(type: string, t: TranslateFn): string {
  return t(`customers.timeline.filter.${type}`, ACTIVITY_TYPE_FALLBACKS[type] ?? type)
}

/** "45m", "1h", "1h 30m". */
export function formatDurationShort(minutes: number, t: TranslateFn): string {
  const rounded = Math.max(Math.round(minutes), 1)
  if (rounded < 60) return t('customers.activities.calendar.minutesShort', '{minutes}m', { minutes: rounded })
  const hours = Math.floor(rounded / 60)
  const rest = rounded % 60
  return rest === 0
    ? t('customers.activities.calendar.hoursShort', '{hours}h', { hours })
    : t('customers.activities.calendar.hoursMinutesShort', '{hours}h {minutes}m', { hours, minutes: rest })
}

/** Who the activity was with (a call, a meeting) or to (an email), when known. */
export function resolveActivityTarget(activity: InteractionSummary): string | null {
  const participant = activity.participants?.find((item) => item.name || item.email)
  if (participant?.name) return participant.name
  if (participant?.email) return participant.email
  if (activity.customer?.displayName) return activity.customer.displayName
  return null
}

/**
 * A history row's quiet last line, "Call · Ada Lovelace · with Sarah · 32m":
 * its type, who logged it, who it was with and how long it took, each part
 * only when it is known.
 */
export function ActivityMeta({ activity, showTarget = true }: { activity: InteractionSummary; showTarget?: boolean }) {
  const t = useT()
  const parts: React.ReactNode[] = [<span key="type">{activityTypeLabel(activity.interactionType, t)}</span>]
  const actor = activity.authorName ?? activity.authorEmail ?? null
  if (actor) parts.push(<span key="actor" className="text-foreground">{actor}</span>)
  const target = showTarget ? resolveActivityTarget(activity) : null
  const direction = activity.interactionType === 'email'
    ? t('customers.activityLog.direction.to', 'to')
    : activity.interactionType === 'call' || activity.interactionType === 'meeting'
      ? t('customers.activityLog.direction.with', 'with')
      : ''
  if (target && direction) {
    parts.push(
      <span key="target">
        <span>{direction}</span> <span className="text-foreground">{target}</span>
      </span>,
    )
  }
  if (typeof activity.duration === 'number' && activity.duration > 0) {
    parts.push(<span key="duration">{formatDurationShort(activity.duration, t)}</span>)
  }
  return (
    <>
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 ? ' · ' : null}
          {part}
        </React.Fragment>
      ))}
    </>
  )
}

export function activityTimestamp(activity: InteractionSummary): string {
  return activity.scheduledAt ?? activity.occurredAt ?? activity.createdAt
}

/**
 * "Today · 14:30", "Yesterday · 09:05", "12 Sep · 16:00": the day in words
 * when it is near, else its date, then the time.
 */
export function formatActivityTimestamp(isoString: string, t: TranslateFn): string {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const diffDays = Math.round((today - day) / 86_400_000)
  const dayLabel = diffDays === 0
    ? t('customers.timeline.date.today', 'today')
    : diffDays === 1
      ? t('customers.timeline.date.yesterday', 'yesterday')
      : diffDays === -1
        ? t('customers.timeline.date.tomorrow', 'tomorrow')
        : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const capitalized = dayLabel.charAt(0).toLocaleUpperCase() + dayLabel.slice(1)
  return `${capitalized} · ${time}`
}

export type ActivityHistoryRowProps = {
  activity: InteractionSummary
  title: React.ReactNode
  /** Drawn after the title, e.g. a mark for an activity that came from an integration. */
  titleAdornment?: React.ReactNode
  body?: React.ReactNode
  /** Extra lines under the body: a location, the email card's actions. */
  details?: React.ReactNode
  /** The quiet last line: who, with whom. */
  meta?: React.ReactNode
  /** The first row of a run draws no rule above it. */
  first?: boolean
  onOpen?: (activity: InteractionSummary) => void
  onMarkDone?: () => void
  markingDone?: boolean
}

/**
 * One row of a customer's activity history, drawn as a list row rather than a
 * card: the type's glyph, then the title, a two-line body and a quiet meta
 * line, with the time at the trailing edge and, while the activity is still
 * open, a "Mark done" under it. Rows are divided by a hairline that starts at
 * the text, as Apple's inset lists are.
 */
export function ActivityHistoryRow({
  activity,
  title,
  titleAdornment,
  body,
  details,
  meta,
  first = false,
  onOpen,
  onMarkDone,
  markingDone = false,
}: ActivityHistoryRowProps) {
  const t = useT()
  const TypeIcon = ACTIVITY_TYPE_ICONS[activity.interactionType] ?? StickyNote
  const timestamp = activityTimestamp(activity)
  const showMarkDone = Boolean(onMarkDone) && isOpenInteractionStatus(activity.status)
  const interactive = Boolean(onOpen)

  return (
    <li>
      <div
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={interactive ? () => onOpen?.(activity) : undefined}
        onKeyDown={interactive ? (event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen?.(activity)
          }
        } : undefined}
        className={cn(
          '-mx-2 flex gap-3 rounded-lg px-2 outline-none transition-colors focus-visible:shadow-focus',
          interactive && 'cursor-pointer hover:bg-surface-muted',
        )}
      >
        <TypeIcon aria-hidden="true" className="mt-3.5 size-4 shrink-0 text-muted-foreground" />
        <div className={cn('flex min-w-0 flex-1 gap-4 py-3', !first && 'border-t border-border')}>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="truncate text-sm font-medium text-foreground">{title}</p>
              {titleAdornment}
            </div>
            {body ? <p className="line-clamp-2 text-sm text-muted-foreground">{body}</p> : null}
            {details}
            {meta ? <p className="truncate text-xs text-muted-foreground">{meta}</p> : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <time dateTime={timestamp} className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
              {formatActivityTimestamp(timestamp, t)}
            </time>
            {showMarkDone ? (
              <Button
                type="button"
                variant="soft"
                size="sm"
                disabled={markingDone}
                onClick={(event) => {
                  event.stopPropagation()
                  onMarkDone?.()
                }}
              >
                <Check className="size-4" />
                {t('customers.activities.actions.markDone', 'Mark done')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  )
}

/** A year heading between history rows once the list crosses into another year. */
export function ActivityHistoryYear({ year }: { year: number }) {
  return (
    <li className="pb-1 pt-5 text-xs font-semibold text-muted-foreground first:pt-0">{year}</li>
  )
}

export type ActivityFilterPopoverProps = {
  activeTypes: string[]
  onTypesChange: (types: string[]) => void
  counts?: ActivityTypeCounts | null
  /** Any filter differs from its default: tints the button and enables Clear. */
  active: boolean
  onReset: () => void
  /** More settings under the types: a date range, a sort order. */
  children?: React.ReactNode
}

/**
 * One Filter button for a history, in place of a row of chips: the types (any
 * number of them, with their counts), then the host's own settings, then
 * Clear. The button takes the accent and a dot while anything is filtered, so
 * the state is visible with the popover closed; nothing around it moves.
 */
export function ActivityFilterPopover({ activeTypes, onTypesChange, counts, active, onReset, children }: ActivityFilterPopoverProps) {
  const t = useT()
  const toggleType = (type: string, checked: boolean) => {
    if (checked) {
      if (!activeTypes.includes(type)) onTypesChange([...activeTypes, type])
      return
    }
    onTypesChange(activeTypes.filter((entry) => entry !== type))
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          type="button"
          variant="soft"
          size="lg"
          className={cn('relative shrink-0', active && 'text-accent-strong')}
          aria-label={t('customers.timeline.filter.button', 'Filter')}
          data-filtered={active ? 'true' : undefined}
        >
          <ListFilter className="size-4" />
          {active ? (
            <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent-strong" />
          ) : null}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1.5">
        <div className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
          {t('customers.timeline.filter.types', 'Types')}
        </div>
        <ul>
          {ACTIVITY_FILTER_TYPES.map((type) => {
            const Icon = ACTIVITY_TYPE_ICONS[type]
            const count = counts?.[type]
            const checked = activeTypes.includes(type)
            const label = activityTypeLabel(type, t)
            return (
              <li key={type}>
                <label className={cn('flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-foreground', MENU_ROW_HOVER)}>
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) => toggleType(type, next === true)}
                    aria-label={typeof count === 'number' && count > 0 ? `${label} ${count}` : label}
                  />
                  {Icon ? <Icon aria-hidden="true" className="size-4 text-muted-foreground" /> : null}
                  <span className="flex-1">{label}</span>
                  {typeof count === 'number' && count > 0 ? (
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                  ) : null}
                </label>
              </li>
            )
          })}
        </ul>
        {children ? <div className="mt-1.5 space-y-3 border-t border-border px-2 pb-1 pt-3">{children}</div> : null}
        <div className="mt-1.5 border-t border-border px-0.5 pt-1.5">
          <Button type="button" variant="ghost" onClick={onReset} disabled={!active} className="w-full">
            {t('customers.activities.filters.clearAll', 'Clear filters')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
