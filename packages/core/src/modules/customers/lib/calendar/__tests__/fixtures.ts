import { calendarStatusOfTask } from '../taskItem'
import type {
  CalendarInteractionItem,
  CalendarInteractionPayload,
  CalendarTaskItem,
} from '../../../components/calendar/types'

export function makePayload(
  overrides: Partial<CalendarInteractionPayload> & { id: string },
): CalendarInteractionPayload {
  return {
    interactionType: 'meeting',
    title: 'Fixture interaction',
    status: 'planned',
    scheduledAt: '2026-06-01T10:00:00.000Z',
    occurredAt: null,
    durationMinutes: 30,
    allDay: false,
    location: null,
    participants: [],
    recurrenceRule: null,
    recurrenceEnd: null,
    appearanceIcon: null,
    appearanceColor: null,
    ownerUserId: null,
    entityId: null,
    dealId: null,
    updatedAt: '2026-06-01T09:00:00.000Z',
    ...overrides,
  }
}

export function makeCalendarItem(
  overrides: Partial<CalendarInteractionItem> & { id: string; start: Date; end: Date },
): CalendarInteractionItem {
  return {
    source: 'interaction',
    title: 'Fixture item',
    interactionType: 'meeting',
    category: 'meeting',
    status: 'planned',
    allDay: false,
    location: null,
    platform: null,
    locationKind: null,
    participants: [],
    ownerUserId: null,
    entityId: null,
    dealId: null,
    color: null,
    isRecurringOccurrence: false,
    updatedAt: null,
    raw: makePayload({ id: overrides.id }),
    ...overrides,
  }
}

/**
 * A Task Manager task as the calendar sees it — the served record carried
 * verbatim under the same id, which is what every task assertion checks.
 */
export function makeCalendarTaskItem(
  overrides: Partial<CalendarTaskItem> & { id: string; start: Date; end: Date },
  taskOverrides: Partial<CalendarTaskItem['task']> = {},
): CalendarTaskItem {
  const { id, ...rest } = overrides
  const taskStatus = taskOverrides.status ?? 'pending'
  return {
    source: 'task',
    id,
    title: 'Fixture task',
    interactionType: 'task',
    category: 'task',
    // Derived the way the mapper derives it, so a fixture cannot describe a
    // combination the real projection never produces.
    status: calendarStatusOfTask(taskStatus),
    allDay: false,
    location: null,
    platform: null,
    locationKind: null,
    participants: [],
    ownerUserId: null,
    entityId: null,
    dealId: null,
    color: null,
    isRecurringOccurrence: false,
    updatedAt: '2026-06-01T09:00:00.000Z',
    task: {
      id,
      projectId: 'project-1',
      projectKey: 'ENG',
      projectName: 'Engineering',
      number: 1,
      title: 'Fixture task',
      status: 'pending',
      priority: 'none',
      assignees: [],
      dueDate: '2026-06-01',
      dueTime: null,
      recurrence: null,
      completedAt: null,
      updatedAt: '2026-06-01T09:00:00.000Z',
      calendarDate: '2026-06-01',
      calendarTime: null,
      ...taskOverrides,
    },
    ...rest,
  }
}
