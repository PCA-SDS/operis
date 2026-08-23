// Presentation vocabulary for tasks: which design-system token each status and
// priority speaks through, and the date/label formatting the rows share.
//
// Statuses are semantic states, so they take `status-*` tokens rather than chart
// colours. There are seven statuses and six status families, so `in_progress`
// takes `pink` — which the design system defines as a categorical accent for
// stage chips, exactly what "in progress" is. `cancelled` deliberately drops out
// of the status palette onto `disabled-foreground`: it is work that stopped, not
// work with an outcome.

import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type {
  MilestoneStatus,
  TaskPriority,
  TaskRecurrenceDto,
  TaskStatus,
} from '../data/types'
import { TASK_STATUSES } from '../data/types'

export type StatusTone = 'neutral' | 'info' | 'pink' | 'error' | 'warning' | 'success' | 'muted'

export type StatusMeta = {
  labelKey: string
  fallback: string
  /** CSS variable for SVG fills and inline swatches. */
  colorVar: string
  textClass: string
  bgClass: string
  borderClass: string
}

const MUTED: Pick<StatusMeta, 'colorVar' | 'textClass' | 'bgClass' | 'borderClass'> = {
  colorVar: 'var(--disabled-foreground)',
  textClass: 'text-disabled-foreground',
  bgClass: 'bg-surface-muted',
  borderClass: 'border-border',
}

function statusTokens(tone: Exclude<StatusTone, 'muted'>) {
  return {
    colorVar: `var(--status-${tone}-icon)`,
    textClass: `text-status-${tone}-text`,
    bgClass: `bg-status-${tone}-bg`,
    borderClass: `border-status-${tone}-border`,
  }
}

export const TASK_STATUS_META: Record<TaskStatus, StatusMeta> = {
  backlog: { labelKey: 'tasks.status.backlog', fallback: 'Backlog', ...statusTokens('neutral') },
  pending: { labelKey: 'tasks.status.pending', fallback: 'To Do', ...statusTokens('info') },
  in_progress: { labelKey: 'tasks.status.in_progress', fallback: 'In Progress', ...statusTokens('pink') },
  blocked: { labelKey: 'tasks.status.blocked', fallback: 'Blocked', ...statusTokens('error') },
  review: { labelKey: 'tasks.status.review', fallback: 'In Review', ...statusTokens('warning') },
  done: { labelKey: 'tasks.status.done', fallback: 'Done', ...statusTokens('success') },
  cancelled: { labelKey: 'tasks.status.cancelled', fallback: 'Cancelled', ...MUTED },
}

/** Board column order. */
export const TASK_STATUS_ORDER: readonly TaskStatus[] = TASK_STATUSES

/** Grouped-list order — what is happening now first, what is parked last. */
export const TASK_GROUP_ORDER: readonly TaskStatus[] = [
  'in_progress',
  'review',
  'blocked',
  'pending',
  'backlog',
  'done',
  'cancelled',
]

export type PriorityMeta = StatusMeta & {
  /** `none` renders as an absence, not as a low-priority flag. */
  flagged: boolean
}

export const TASK_PRIORITY_META: Record<TaskPriority, PriorityMeta> = {
  none: { labelKey: 'tasks.priority.none', fallback: 'No priority', flagged: false, ...MUTED },
  low: { labelKey: 'tasks.priority.low', fallback: 'Low', flagged: true, ...statusTokens('neutral') },
  medium: { labelKey: 'tasks.priority.medium', fallback: 'Medium', flagged: true, ...statusTokens('info') },
  high: { labelKey: 'tasks.priority.high', fallback: 'High', flagged: true, ...statusTokens('warning') },
  urgent: { labelKey: 'tasks.priority.urgent', fallback: 'Urgent', flagged: true, ...statusTokens('error') },
}

export const MILESTONE_STATUS_META: Record<MilestoneStatus, StatusMeta> = {
  planned: { labelKey: 'tasks.milestoneStatus.planned', fallback: 'Planned', ...statusTokens('neutral') },
  active: { labelKey: 'tasks.milestoneStatus.active', fallback: 'Active', ...statusTokens('warning') },
  completed: { labelKey: 'tasks.milestoneStatus.completed', fallback: 'Completed', ...statusTokens('success') },
}

export function taskRef(projectKey: string, number: number): string {
  return `${projectKey}-${number}`
}

// ---------------------------------------------------------------------
// Dates. Task due dates are calendar days, so they are formatted in UTC —
// rendering a stored `2026-03-04` in the browser's zone would show the 3rd
// to anyone west of Greenwich.
// ---------------------------------------------------------------------

export function formatTaskDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatTaskTimeOfDay(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function formatTaskDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}, ${formatTaskTimeOfDay(iso)}`
}

export function localTodayIso(): string {
  return localIsoOf(new Date())
}

export function localDayOf(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return localIsoOf(date)
}

function localIsoOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function isOverdue(iso: string | null | undefined): boolean {
  if (!iso) return false
  return iso.slice(0, 10) < localTodayIso()
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function formatTaskTime(hhmm: string | null | undefined): string {
  if (!hhmm) return ''
  const [hour = 0, minute = 0] = hhmm.split(':').map(Number)
  const meridiem = hour < 12 ? 'AM' : 'PM'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return `${hour12}:${String(minute).padStart(2, '0')} ${meridiem}`
}

export function addLocalDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export type DayHeadingParts = {
  dayMonth: string
  weekday: string
  /** 'today' | 'tomorrow' | null — the caller translates it. */
  relative: 'today' | 'tomorrow' | null
}

export function dayHeadingParts(iso: string): DayHeadingParts | null {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null
  const today = localTodayIso()
  const day = iso.slice(0, 10)
  return {
    dayMonth: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    weekday: date.toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' }),
    relative: day === today ? 'today' : day === addLocalDays(today, 1) ? 'tomorrow' : null,
  }
}

/** Which relative word (if any) a due chip should use instead of a date. */
export function dueChipRelative(iso: string): 'today' | 'yesterday' | 'tomorrow' | null {
  const today = localTodayIso()
  const day = iso.slice(0, 10)
  if (day === today) return 'today'
  if (day === addLocalDays(today, -1)) return 'yesterday'
  if (day === addLocalDays(today, 1)) return 'tomorrow'
  return null
}

export const WEEKDAY_LABEL_KEYS = [
  'tasks.weekday.sunday',
  'tasks.weekday.monday',
  'tasks.weekday.tuesday',
  'tasks.weekday.wednesday',
  'tasks.weekday.thursday',
  'tasks.weekday.friday',
  'tasks.weekday.saturday',
] as const

export const WEEKDAY_FALLBACKS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

export function weekdayLabel(translate: TranslateFn, index: number): string {
  return translate(WEEKDAY_LABEL_KEYS[index] ?? '', WEEKDAY_FALLBACKS[index] ?? '')
}

/** "Every Tuesday", "Monthly on day 15" — the sentence a recurrence chip shows. */
export function describeRecurrence(
  translate: TranslateFn,
  recurrence: TaskRecurrenceDto | null | undefined,
): string {
  if (!recurrence) return ''
  switch (recurrence.freq) {
    case 'daily':
      return translate('tasks.recurrence.daily', 'Every day')
    case 'weekdays':
      return translate('tasks.recurrence.weekdays', 'Every weekday')
    case 'weekly':
      return recurrence.weekday != null
        ? translate('tasks.recurrence.weeklyOn', 'Every {weekday}', {
            weekday: weekdayLabel(translate, recurrence.weekday),
          })
        : translate('tasks.recurrence.weekly', 'Every week')
    case 'monthly':
      return recurrence.dayOfMonth != null
        ? translate('tasks.recurrence.monthlyOn', 'Monthly on day {day}', { day: recurrence.dayOfMonth })
        : translate('tasks.recurrence.monthly', 'Every month')
  }
}

/** Localised day heading: "4 Mar ‧ Today ‧ Wednesday". */
export function formatDayHeading(translate: TranslateFn, iso: string): string {
  const parts = dayHeadingParts(iso)
  if (!parts) return '—'
  const relative =
    parts.relative === 'today'
      ? translate('tasks.common.today', 'Today')
      : parts.relative === 'tomorrow'
        ? translate('tasks.common.tomorrow', 'Tomorrow')
        : null
  return [parts.dayMonth, relative, parts.weekday].filter(Boolean).join(' ‧ ')
}

/** Due chip text: a relative word when the date is near, the date otherwise. */
export function formatDueChip(translate: TranslateFn, iso: string): string {
  const relative = dueChipRelative(iso)
  if (relative === 'today') return translate('tasks.common.today', 'Today')
  if (relative === 'yesterday') return translate('tasks.common.yesterday', 'Yesterday')
  if (relative === 'tomorrow') return translate('tasks.common.tomorrow', 'Tomorrow')
  return formatTaskDate(iso)
}

/** "edited 14:32" for a same-day edit, "edited 04 Mar 2026, 14:32" otherwise. */
export function formatEditedAt(translate: TranslateFn, createdAt: string, updatedAt: string): string {
  const created = new Date(createdAt)
  const updated = new Date(updatedAt)
  if (Number.isNaN(created.getTime()) || Number.isNaN(updated.getTime())) {
    return translate('tasks.comments.editedPlain', 'edited')
  }
  const sameDay = created.toDateString() === updated.toDateString()
  return translate('tasks.comments.edited', 'edited {when}', {
    when: sameDay ? formatTaskTimeOfDay(updatedAt) : formatTaskDateTime(updatedAt),
  })
}
