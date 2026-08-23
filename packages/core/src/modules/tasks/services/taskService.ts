import type { EntityManager } from '@mikro-orm/postgresql'
import { assertFound } from '@open-mercato/shared/lib/crud/errors'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { TasksProject, TasksTask } from '../data/entities'
import type { PagedResponse, TaskBoardResponse, TaskDetailDto, TaskListItemDto } from '../data/types'
import type { TaskListQuery } from '../data/validators'
import {
  buildTaskHydrationContext,
  mapTasks,
  toTaskDetailDto,
} from '../lib/taskReadModel'
import type { TasksScope } from '../lib/people'
import { loadTasksMessages } from '../lib/messages'

/** Board order: rank ascending, creation time as the tiebreaker so two tasks
 *  that were never dragged keep a stable order. */
const BOARD_ORDER_BY = [{ rank: 'asc' as const }, { createdAt: 'asc' as const }]

export interface TaskService {
  listByProject(
    em: EntityManager,
    scope: TasksScope,
    projectId: string,
    query: TaskListQuery,
  ): Promise<PagedResponse<TaskListItemDto>>
  board(em: EntityManager, scope: TasksScope, projectId: string): Promise<TaskBoardResponse>
  getDetail(em: EntityManager, scope: TasksScope, id: string): Promise<TaskDetailDto>
  requireTask(em: EntityManager, scope: TasksScope, id: string): Promise<TasksTask>
}

export class DefaultTaskService implements TaskService {
  async listByProject(
    em: EntityManager,
    scope: TasksScope,
    projectId: string,
    query: TaskListQuery,
  ): Promise<PagedResponse<TaskListItemDto>> {
    const messages = await loadTasksMessages()
    const project = assertFound(
      await em.findOne(TasksProject, {
        id: projectId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      }),
      messages.projectNotFound,
    )

    const filters: Record<string, unknown>[] = [
      {
        projectId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        archivedAt: null,
        deletedAt: null,
      },
    ]
    if (query.status) filters.push({ status: query.status })
    if (query.priority) filters.push({ priority: query.priority })
    if (query.milestoneId) filters.push({ milestoneId: query.milestoneId })
    if (query.search?.trim()) {
      const pattern = `%${escapeLikePattern(query.search.trim())}%`
      filters.push({ $or: [{ title: { $ilike: pattern } }, { descriptionPlaintext: { $ilike: pattern } }] })
    }
    if (query.assigneeId) {
      const ids = await taskIdsWithAssignee(em, scope, query.assigneeId)
      if (ids.length === 0) return emptyPage(query.page, query.pageSize)
      filters.push({ id: { $in: ids } })
    }
    if (query.labelId) {
      const ids = await taskIdsWithLabel(em, scope, query.labelId)
      if (ids.length === 0) return emptyPage(query.page, query.pageSize)
      filters.push({ id: { $in: ids } })
    }

    const [rows, total] = await em.findAndCount(TasksTask, { $and: filters } as never, {
      orderBy: buildTaskOrderBy(query) as never,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    })

    return {
      items: await mapTasks(em, scope, rows, [project]),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    }
  }

  /** The whole board in one response — a Kanban shows every column at once, so
   *  paginating it would just make the client stitch pages back together. */
  async board(em: EntityManager, scope: TasksScope, projectId: string): Promise<TaskBoardResponse> {
    const messages = await loadTasksMessages()
    const project = assertFound(
      await em.findOne(TasksProject, {
        id: projectId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      }),
      messages.projectNotFound,
    )
    const rows = await em.find(
      TasksTask,
      {
        projectId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        archivedAt: null,
        deletedAt: null,
      },
      { orderBy: BOARD_ORDER_BY as never },
    )
    return { tasks: await mapTasks(em, scope, rows, [project]) }
  }

  async requireTask(em: EntityManager, scope: TasksScope, id: string): Promise<TasksTask> {
    const messages = await loadTasksMessages()
    return assertFound(
      await em.findOne(TasksTask, {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      }),
      messages.taskNotFound,
    )
  }

  async getDetail(em: EntityManager, scope: TasksScope, id: string): Promise<TaskDetailDto> {
    const task = await this.requireTask(em, scope, id)
    const subtasks = await em.find(
      TasksTask,
      {
        parentTaskId: task.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      { orderBy: BOARD_ORDER_BY as never },
    )
    const [ctx, subtaskCtx] = await Promise.all([
      buildTaskHydrationContext(em, scope, [task]),
      buildTaskHydrationContext(em, scope, subtasks),
    ])
    return toTaskDetailDto(task, ctx, subtasks, subtaskCtx)
  }
}

function emptyPage(page: number, pageSize: number): PagedResponse<TaskListItemDto> {
  return { items: [], page, pageSize, total: 0, totalPages: 1 }
}

function buildTaskOrderBy(query: TaskListQuery) {
  const order = query.order
  switch (query.sort) {
    case 'title':
      return [{ title: order }, { id: 'desc' }]
    case 'dueDate':
      return [{ dueDate: order }, { id: 'desc' }]
    case 'priority':
      return [{ priority: order }, { id: 'desc' }]
    case 'status':
      return [{ status: order }, { id: 'desc' }]
    default:
      return [{ createdAt: order }, { id: 'desc' }]
  }
}

async function taskIdsWithAssignee(
  em: EntityManager,
  scope: TasksScope,
  userId: string,
): Promise<string[]> {
  const db = em.getKysely<any>() as any
  const rows = (await db
    .selectFrom('tasks_task_assignees')
    .select('task_id')
    .where('user_id', '=', userId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .execute()) as Array<{ task_id: string }>
  return [...new Set(rows.map((row) => row.task_id))]
}

async function taskIdsWithLabel(
  em: EntityManager,
  scope: TasksScope,
  labelId: string,
): Promise<string[]> {
  const db = em.getKysely<any>() as any
  const rows = (await db
    .selectFrom('tasks_task_labels')
    .select('task_id')
    .where('label_id', '=', labelId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .execute()) as Array<{ task_id: string }>
  return [...new Set(rows.map((row) => row.task_id))]
}
