import type {
  CalendarItemStatus,
  CalendarParticipant,
  CalendarTaskItem,
  CalendarTaskPayload,
} from '../../components/calendar/types'
import { addCalendarDays, startOfLocalDay } from './time'

/**
 * How long a task occupies on the time grid.
 *
 * A task is a deadline, not an interval — the Task Manager stores a due date
 * and an optional wall-clock time, with no duration — so a grid that draws it
 * as a block has to choose a nominal length. One hour reads as "around then"
 * without implying a commitment the record does not hold, and matches what the
 * tasks module's own calendar panel draws. It is restated rather than imported
 * because module gating forbids this module importing that one.
 */
export const TASK_SLOT_MINUTES = 60

/**
 * Task Manager task → calendar entry.
 *
 * This is a projection, not a copy: the entry keeps the task's own id and
 * carries the served record verbatim, so every write the calendar makes goes
 * back to that row through the Task Manager's own API. Nothing here invents a
 * second scheduling model — the task domain stores a due date plus an optional
 * wall-clock time, and that is exactly what is rendered.
 */

/** Wire status → the calendar's three display states. */
const TASK_STATUS_TO_CALENDAR: Record<string, CalendarItemStatus> = {
  done: 'done',
  cancelled: 'canceled',
}

export function calendarStatusOfTask(status: string): CalendarItemStatus {
  return TASK_STATUS_TO_CALENDAR[status] ?? 'planned'
}

/**
 * Parse a `YYYY-MM-DD` calendar date into local midnight.
 *
 * Deliberately not `new Date(iso)`, which reads a bare date as UTC and lands a
 * task on the previous day for anyone west of Greenwich.
 */
export function parseCalendarDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return Number.isNaN(date.getTime()) ? null : date
}

/** Parse a `HH:MM` wall-clock string into minutes from midnight. */
export function parseWallClockMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** `HH:MM` for a wall-clock time, the shape the task API stores. */
export function formatWallClockTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** `YYYY-MM-DD` in local time — the shape `dueDate` stores. */
export function formatCalendarDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function participantsOfTask(task: CalendarTaskPayload): CalendarParticipant[] {
  const seen = new Set<string>()
  const participants: CalendarParticipant[] = []
  for (const assignee of task.assignees ?? []) {
    if (seen.has(assignee.id)) continue
    seen.add(assignee.id)
    participants.push({ userId: assignee.id, name: assignee.name })
  }
  return participants
}

/**
 * Project one task onto the grid.
 *
 * A task with a due time is a timed block of nominal length; a task with only a
 * due date goes to the all-day lane, which is what "due some time that day"
 * actually means and is what the wire contract already says `calendarTime:
 * null` stands for. Rendering it at midnight instead would assert a time the
 * record does not hold.
 */
export function mapTaskToCalendarItem(task: CalendarTaskPayload): CalendarTaskItem | null {
  const day = parseCalendarDate(task.calendarDate)
  if (!day) return null

  const participants = participantsOfTask(task)
  const base = {
    source: 'task' as const,
    id: task.id,
    title: task.title,
    interactionType: 'task',
    category: 'task' as const,
    status: calendarStatusOfTask(task.status),
    location: null,
    platform: null,
    locationKind: null,
    participants,
    // Conflict scoping ("my meetings") reads this; a task's first assignee is
    // the closest thing it has to an owner.
    ownerUserId: participants[0]?.userId ?? null,
    entityId: null,
    dealId: null,
    // Tasks take their colour from the Task Manager's status vocabulary rather
    // than a per-record colour, so they stay visibly a different kind of thing
    // from a CRM event and cannot drift from the board's own palette.
    color: null,
    // The task domain advances a recurring task's due date on completion rather
    // than materialising future rows, so there is never an occurrence to expand.
    isRecurringOccurrence: false,
    updatedAt: task.updatedAt ?? null,
    task,
  }

  const minutes = task.calendarTime ? parseWallClockMinutes(task.calendarTime) : null
  if (minutes === null) {
    const start = startOfLocalDay(day)
    return { ...base, allDay: true, start, end: addCalendarDays(start, 1) }
  }

  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60)
  return {
    ...base,
    allDay: false,
    start,
    end: new Date(start.getTime() + TASK_SLOT_MINUTES * 60_000),
  }
}

export type TaskScheduleChange = { dueDate: string; dueTime: string | null }

/**
 * The Task Manager patch a calendar drag means.
 *
 * A task has no duration, so only where it starts is meaningful: dropping it in
 * the all-day lane clears the time, dropping it on the grid sets one. A resize
 * has nothing to write and never reaches here.
 */
export function taskScheduleChangeFor(start: Date, allDay: boolean): TaskScheduleChange {
  return {
    dueDate: formatCalendarDate(start),
    dueTime: allDay ? null : formatWallClockTime(start),
  }
}

/**
 * The IANA zone the caller is reading the calendar in.
 *
 * The task API treats `tz` as optional and falls back to UTC, but completion
 * resolves `completedAt` — and a recurring task's next due date — against it,
 * so every task write from the calendar has to say which clock it meant.
 */
export function calendarTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
