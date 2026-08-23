import type { EntityManager } from '@mikro-orm/postgresql'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { TasksProject, TasksTask } from '../data/entities'
import {
  TASK_CALENDAR_MAX_ITEMS,
  TASK_CALENDAR_MAX_RANGE_DAYS,
  TASK_TERMINAL_STATUSES,
  type MyTaskView,
  type PagedResponse,
  type TaskCalendarItemDto,
  type TaskCalendarResponse,
  type TaskListItemDto,
} from '../data/types'
import type { MyTasksQuery, TaskCalendarQuery } from '../data/validators'
import { buildTaskHydrationContext, toTaskListItemDto } from '../lib/taskReadModel'
import { loadAssignedTaskIds } from '../lib/assignment'
import type { TasksScope } from '../lib/people'
import { loadTasksMessages } from '../lib/messages'
import {
  dateOrNull,
  isoDate,
  parseCalendarDate,
  resolveTimeZone,
  todayInTimeZone,
  zonedDayStartUtc,
  zonedWallClock,
} from '../lib/values'

const DAY_MS = 86_400_000

export interface MyTasksService {
  list(
    em: EntityManager,
    scope: TasksScope,
    userId: string,
    query: MyTasksQuery,
  ): Promise<PagedResponse<TaskListItemDto>>
  calendar(
    em: EntityManager,
    scope: TasksScope,
    userId: string,
    query: TaskCalendarQuery,
  ): Promise<TaskCalendarResponse>
}

export class DefaultMyTasksService implements MyTasksService {
  async list(
    em: EntityManager,
    scope: TasksScope,
    userId: string,
    query: MyTasksQuery,
  ): Promise<PagedResponse<TaskListItemDto>> {
    const liveProjectIds = await loadLiveProjectIds(em, scope)
    if (liveProjectIds.length === 0) {
      return { items: [], page: query.page, pageSize: query.pageSize, total: 0, totalPages: 1 }
    }

    const filters: Record<string, unknown>[] = [
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        archivedAt: null,
        deletedAt: null,
        projectId: { $in: liveProjectIds },
        status: query.view === 'completed' ? 'done' : { $nin: [...TASK_TERMINAL_STATUSES] },
      },
    ]

    if (query.view === 'today') {
      const today = todayInTimeZone(resolveTimeZone(query.tz))
      filters.push({ dueDate: { $lte: dateOrNull(today)! } })
    } else if (query.view === 'upcoming') {
      filters.push({ dueDate: { $ne: null } })
    } else if (query.view === 'assigned') {
      const assignedIds = await loadAssignedTaskIds(em, scope, userId)
      if (assignedIds.length === 0) {
        return { items: [], page: query.page, pageSize: query.pageSize, total: 0, totalPages: 1 }
      }
      filters.push({ id: { $in: assignedIds } })
    }

    if (query.search?.trim()) {
      const pattern = `%${escapeLikePattern(query.search.trim())}%`
      filters.push({ $or: [{ title: { $ilike: pattern } }, { descriptionPlaintext: { $ilike: pattern } }] })
    }

    const [rows, total] = await em.findAndCount(TasksTask, { $and: filters } as never, {
      orderBy: orderByForView(query.view) as never,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    })

    const ctx = await buildTaskHydrationContext(em, scope, rows)
    return {
      items: rows.map((task) => toTaskListItemDto(task, ctx)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    }
  }

  /**
   * A date-range window over the caller's own tasks. The server resolves each
   * task's calendar placement so the client never redoes timezone maths — in
   * `done` mode that means converting `completedAt` to the caller's wall clock.
   */
  async calendar(
    em: EntityManager,
    scope: TasksScope,
    userId: string,
    query: TaskCalendarQuery,
  ): Promise<TaskCalendarResponse> {
    const messages = await loadTasksMessages()
    const timeZone = resolveTimeZone(query.tz)
    const from = parseCalendarDate(query.from)
    const to = parseCalendarDate(query.to)
    if (to.getTime() < from.getTime()) throw badRequest(messages.calendarRangeInverted)
    const spanDays = (to.getTime() - from.getTime()) / DAY_MS + 1
    if (spanDays > TASK_CALENDAR_MAX_RANGE_DAYS) {
      throw badRequest(messages.calendarRangeTooWide(TASK_CALENDAR_MAX_RANGE_DAYS))
    }

    const [liveProjectIds, assignedIds] = await Promise.all([
      loadLiveProjectIds(em, scope),
      loadAssignedTaskIds(em, scope, userId),
    ])
    if (liveProjectIds.length === 0 || assignedIds.length === 0) {
      return { mode: query.mode, from: query.from, to: query.to, items: [], truncated: false }
    }

    const filters: Record<string, unknown>[] = [
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        archivedAt: null,
        deletedAt: null,
        projectId: { $in: liveProjectIds },
        id: { $in: assignedIds },
      },
    ]
    if (query.search?.trim()) {
      const pattern = `%${escapeLikePattern(query.search.trim())}%`
      filters.push({ $or: [{ title: { $ilike: pattern } }, { descriptionPlaintext: { $ilike: pattern } }] })
    }

    if (query.mode === 'done') {
      filters.push({
        status: 'done',
        completedAt: {
          $gte: zonedDayStartUtc(query.from, timeZone),
          $lt: zonedDayStartUtc(isoDate(new Date(to.getTime() + DAY_MS))!, timeZone),
        },
      })
    } else {
      filters.push({ status: { $ne: 'cancelled' }, dueDate: { $gte: from, $lte: to } })
    }

    const rows = await em.find(TasksTask, { $and: filters } as never, {
      orderBy: (query.mode === 'done'
        ? [{ completedAt: 'asc' }, { id: 'asc' }]
        : [{ dueDate: 'asc' }, { dueTime: 'asc' }, { priority: 'desc' }, { id: 'asc' }]) as never,
      // One over the cap, so the response can honestly say it was cut.
      limit: TASK_CALENDAR_MAX_ITEMS + 1,
    })

    const truncated = rows.length > TASK_CALENDAR_MAX_ITEMS
    const visible = rows.slice(0, TASK_CALENDAR_MAX_ITEMS)
    const ctx = await buildTaskHydrationContext(em, scope, visible)
    const items = visible
      .map((task) => {
        const dto = toTaskListItemDto(task, ctx)
        if (query.mode === 'done') {
          if (!task.completedAt) return null
          const wall = zonedWallClock(task.completedAt, timeZone)
          return { ...dto, calendarDate: wall.date, calendarTime: wall.time }
        }
        if (!dto.dueDate) return null
        return { ...dto, calendarDate: dto.dueDate, calendarTime: dto.dueTime }
      })
      .filter((item): item is TaskCalendarItemDto => item !== null)

    return { mode: query.mode, from: query.from, to: query.to, items, truncated }
  }
}

/** Project ids the personal views may draw from: in scope and not archived. */
export async function loadLiveProjectIds(em: EntityManager, scope: TasksScope): Promise<string[]> {
  const rows = await em.find(
    TasksProject,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      archivedAt: null,
      deletedAt: null,
    },
    { fields: ['id'] },
  )
  return rows.map((project) => project.id)
}

function orderByForView(view: MyTaskView) {
  if (view === 'completed') return [{ completedAt: 'desc' }, { id: 'desc' }]
  if (view === 'all') return [{ createdAt: 'desc' }, { id: 'desc' }]
  return [{ dueDate: 'asc' }, { dueTime: 'asc' }, { priority: 'desc' }, { id: 'desc' }]
}
