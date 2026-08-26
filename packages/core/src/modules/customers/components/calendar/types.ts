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

export interface CalendarItem {
  id: string
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
  raw: CalendarInteractionPayload
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
  onNewEvent?: () => void
}

export interface CalendarToolbarProps {
  view: CalendarView
  anchor: Date
  range: CalendarRange
  preset: CalendarRangePreset | null
  search: string
  filters: CalendarFiltersValue
  typeOptions: Array<{ value: string; label: string }>
  ownerOptions: Array<{ value: string; label: string }>
  onToday(): void
  onPresetChange(preset: CalendarRangePreset): void
  onAnchorChange(date: Date): void
  onSearchChange(value: string): void
  onFiltersChange(value: CalendarFiltersValue): void
  onOpenSettings(): void
}

export interface CalendarTabsProps {
  tab: CalendarTab
  counts: { all: number; meetings: number; events: number }
  view: CalendarView
  /** Transient status text (truncation, refreshing) shown between the two controls. */
  status?: ReactNode
  onTabChange(tab: CalendarTab): void
  onViewChange(view: CalendarView): void
}

export interface CalendarFooterProps {
  timezoneLabel: string
  onOpenShortcuts?: () => void
}
