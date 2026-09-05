import type { ReactNode } from 'react'
import { z } from 'zod'

export type CalendarView = 'day' | 'week' | 'month' | 'agenda'

export type CalendarCategory = 'meeting' | 'event' | 'task' | 'other'

export type CalendarItemStatus = 'planned' | 'done' | 'canceled'

export type CalendarPlatform = 'zoom' | 'meet' | 'slack' | 'teams'

export type CalendarLocationKind = 'url' | 'venue' | 'platform'

export type CalendarTab = 'all' | 'meetings' | 'events'

export type CalendarRangePreset = 'thisWeek' | 'next7' | 'thisMonth' | 'next30'

export type CalendarRange = { from: Date; to: Date }

const calendarParticipantSchema = z
  .object({
    userId: z.string(),
    name: z.string().optional(),
    email: z.string().optional(),
  })
  .passthrough()

export const calendarInteractionPayloadSchema = z
  .object({
    id: z.string(),
    interactionType: z.string(),
    title: z.string().nullable().optional(),
    status: z.string(),
    scheduledAt: z.string().nullable().optional(),
    occurredAt: z.string().nullable().optional(),
    durationMinutes: z.number().nullable().optional(),
    allDay: z.boolean().nullable().optional(),
    location: z.string().nullable().optional(),
    participants: z.array(calendarParticipantSchema).nullable().optional(),
    recurrenceRule: z.string().nullable().optional(),
    recurrenceEnd: z.string().nullable().optional(),
    appearanceIcon: z.string().nullable().optional(),
    appearanceColor: z.string().nullable().optional(),
    ownerUserId: z.string().nullable().optional(),
    entityId: z.string().nullable().optional(),
    dealId: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough()

export type CalendarInteractionPayload = z.infer<typeof calendarInteractionPayloadSchema>

export type CalendarParticipant = { userId: string; name?: string; email?: string }

const calendarTaskAssigneeSchema = z.object({ id: z.string(), name: z.string() }).passthrough()

/**
 * The calendar's consumer contract over the Task Manager's calendar window.
 *
 * Declared here rather than imported from the tasks module on purpose: a static
 * import would make disabling tasks break this module, which is the one thing
 * module gating must not allow (`tasks/__tests__/moduleGating.test.ts` enforces
 * it). The tasks module stays the source of truth — this only names the fields
 * the grid reads off the wire, exactly as `calendarInteractionPayloadSchema`
 * does for the interactions API, and `passthrough` keeps everything else intact
 * so a record can be handed back to the task API unchanged.
 */
export const calendarTaskPayloadSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    priority: z.string().optional(),
    projectId: z.string(),
    projectName: z.string().optional(),
    projectKey: z.string().optional(),
    number: z.number().optional(),
    dueDate: z.string().nullable().optional(),
    dueTime: z.string().nullable().optional(),
    /** The day the window placed this task on, `YYYY-MM-DD`. */
    calendarDate: z.string(),
    /** Wall-clock `HH:MM` it sits at, or null for the all-day lane. */
    calendarTime: z.string().nullable(),
    assignees: z.array(calendarTaskAssigneeSchema).optional(),
    completedAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
    recurrence: z.object({ freq: z.string() }).passthrough().nullable().optional(),
  })
  .passthrough()

export type CalendarTaskPayload = z.infer<typeof calendarTaskPayloadSchema>

/**
 * Which domain an entry belongs to.
 *
 * The calendar is a view over two real, separately-owned models, not one
 * flattened store: a CRM interaction is an *interval* (an instant plus a
 * duration, optionally all-day, optionally recurring by RRULE), and a task is a
 * *deadline* (a due date plus an optional wall-clock time, no duration). Each
 * keeps its own source of truth and its own write path; this tag is what routes
 * an edit back to the right one.
 */
export type CalendarSource = 'interaction' | 'task'

interface CalendarItemBase {
  id: string
  source: CalendarSource
  title: string
  interactionType: string
  category: CalendarCategory
  status: CalendarItemStatus
  start: Date
  end: Date
  allDay: boolean
  location: string | null
  platform: CalendarPlatform | null
  locationKind: CalendarLocationKind | null
  participants: CalendarParticipant[]
  ownerUserId: string | null
  entityId: string | null
  dealId: string | null
  color: string | null
  isRecurringOccurrence: boolean
  updatedAt: string | null
}

/** A CRM interaction — meeting, call, event. Owned by `customers`. */
export interface CalendarInteractionItem extends CalendarItemBase {
  source: 'interaction'
  raw: CalendarInteractionPayload
}

/**
 * A Task Manager task.
 *
 * `id` is the task's own id and `task` is the record the Task Manager serves,
 * carried verbatim — this entry *is* that task rendered on a grid, not a copy
 * of it, so there is one identity and one row behind every surface that shows
 * it.
 */
export interface CalendarTaskItem extends CalendarItemBase {
  source: 'task'
  task: CalendarTaskPayload
}

export type CalendarItem = CalendarInteractionItem | CalendarTaskItem

export function isTaskItem(item: CalendarItem): item is CalendarTaskItem {
  return item.source === 'task'
}

export interface CalendarFiltersValue {
  types: string[]
  status: string | null
  ownerUserId: string | null
}

export type CalendarSnapMinutes = 15 | 30

export type CalendarWorkingHours = { startHour: number; endHour: number }

/** A drag or resize result, before it is validated and persisted. */
export type CalendarReschedule = {
  item: CalendarItem
  start: Date
  end: Date
  allDay: boolean
}

export interface TimeGridProps {
  days: 1 | 7
  anchor: Date
  items: CalendarItem[]
  conflictIds: Set<string>
  showWeekends: boolean
  showConflicts: boolean
  aiSummaries: boolean
  canManage?: boolean
  highlightItemId?: string | null
  snapMinutes?: CalendarSnapMinutes
  workingHours?: CalendarWorkingHours
  onItemClick(item: CalendarItem): void
  onJoin(item: CalendarItem): void
  onCreateRange?(start: Date, end: Date): void
  onReschedule?(change: CalendarReschedule): void
}

export interface MonthGridProps {
  anchor: Date
  items: CalendarItem[]
  weekStartsOn?: WeekStartDay
  canManage?: boolean
  aiSummaries?: boolean
  onItemClick(item: CalendarItem): void
  onJoin?(item: CalendarItem): void
  onDayOpen(date: Date): void
  onCreateAt?(date: Date): void
}

/** Locale week start, expressed the way date-fns expects it. */
export type WeekStartDay = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface AgendaListProps {
  anchor: Date
  horizonDays: number
  items: CalendarItem[]
  typeLabels?: Record<string, string>
  onItemClick(item: CalendarItem): void
}

export interface UpcomingCard {
  item: CalendarItem
  kind: 'today' | 'conflicted' | 'cancelled' | 'future'
  conflictCount: number
}

export interface UpcomingCardsProps {
  cards: UpcomingCard[]
  canManage?: boolean
  onJoin(item: CalendarItem): void
  onSeeConflict(item: CalendarItem): void
  onOpen(item: CalendarItem): void
  onEdit(item: CalendarItem): void
  onCancel(item: CalendarItem): void
}

export interface CalendarHeaderProps {
  view: CalendarView
  anchor: Date
  range: CalendarRange
  onPrevious?: () => void
  onNext?: () => void
  onToday?: () => void
  onViewChange?(view: CalendarView): void
  onNewEvent?: () => void
  /** Present only when the tasks module is active and the caller may edit tasks. */
  onNewTask?: () => void
  onOpenShortcuts?: () => void
}

export interface CalendarToolbarProps {
  anchor: Date
  search: string
  filters: CalendarFiltersValue
  typeOptions: Array<{ value: string; label: string }>
  ownerOptions: Array<{ value: string; label: string }>
  onAnchorChange(date: Date): void
  onSearchChange(value: string): void
  onFiltersChange(value: CalendarFiltersValue): void
}

/** The scope row: category filter, range preset and the jump-to-date control. */
export interface CalendarScopeBarProps {
  tab: CalendarTab
  counts: { all: number; meetings: number; events: number }
  range: CalendarRange
  anchor: Date
  preset: CalendarRangePreset | null
  /** Transient status text (truncation, refreshing) shown between the controls. */
  status?: ReactNode
  /** Search and filters — the controls that narrow what is shown. */
  trailing?: ReactNode
  onTabChange(tab: CalendarTab): void
  onPresetChange(preset: CalendarRangePreset): void
  onAnchorChange(date: Date): void
  onOpenSettings(): void
}

export interface CalendarTabsProps {
  tab: CalendarTab
  counts: { all: number; meetings: number; events: number }
  onTabChange(tab: CalendarTab): void
}
