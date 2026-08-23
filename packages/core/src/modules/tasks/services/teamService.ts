import type { EntityManager } from '@mikro-orm/postgresql'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { TasksTask } from '../data/entities'
import {
  TASK_TERMINAL_STATUSES,
  type PagedResponse,
  type TaskBoardResponse,
  type TaskListItemDto,
  type TeamMemberDto,
  type TeamMembersResponse,
} from '../data/types'
import type { TeamTasksQuery } from '../data/validators'
import { buildTaskHydrationContext, mapTasks, toTaskListItemDto } from '../lib/taskReadModel'
import { loadAssignedTaskIds } from '../lib/assignment'
import { listScopedUsers, loadRoleNamesByUserIds, type TasksScope } from '../lib/people'
import { loadTasksMessages } from '../lib/messages'
import { loadLiveProjectIds } from './myTasksService'

/**
 * Whose tasks a caller may look at.
 *
 * PCA ERP resolved this from a reporting line. Operis has no reporting line;
 * its equivalent boundary is the organization the caller is scoped to, which is
 * already the boundary every other tasks read honours. So the team is the
 * scope's people, the caller first.
 */
export interface TeamService {
  listMembers(em: EntityManager, scope: TasksScope, userId: string): Promise<TeamMembersResponse>
  memberBoard(
    em: EntityManager,
    scope: TasksScope,
    actorId: string,
    targetUserId: string,
  ): Promise<TaskBoardResponse>
  memberTasks(
    em: EntityManager,
    scope: TasksScope,
    actorId: string,
    targetUserId: string,
    query: TeamTasksQuery,
  ): Promise<PagedResponse<TaskListItemDto>>
}

export class DefaultTeamService implements TeamService {
  async listMembers(
    em: EntityManager,
    scope: TasksScope,
    userId: string,
  ): Promise<TeamMembersResponse> {
    const people = await listScopedUsers(em, scope)
    const roleNames = await loadRoleNamesByUserIds(em, people.map((person) => person.id))
    const openCounts = await loadOpenTaskCounts(em, scope, people.map((person) => person.id))

    const members: TeamMemberDto[] = people.map((person) => ({
      id: person.id,
      name: person.name,
      email: person.email,
      roleNames: roleNames.get(person.id) ?? [],
      isSelf: person.id === userId,
      openTaskCount: openCounts.get(person.id) ?? 0,
    }))

    members.sort((a, b) => (a.isSelf === b.isSelf ? a.name.localeCompare(b.name) : a.isSelf ? -1 : 1))
    return { members }
  }

  async memberBoard(
    em: EntityManager,
    scope: TasksScope,
    actorId: string,
    targetUserId: string,
  ): Promise<TaskBoardResponse> {
    await this.assertCanView(em, scope, actorId, targetUserId)
    const [liveProjectIds, assignedIds] = await Promise.all([
      loadLiveProjectIds(em, scope),
      loadAssignedTaskIds(em, scope, targetUserId),
    ])
    if (liveProjectIds.length === 0 || assignedIds.length === 0) return { tasks: [] }

    const rows = await em.find(
      TasksTask,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        archivedAt: null,
        deletedAt: null,
        projectId: { $in: liveProjectIds },
        id: { $in: assignedIds },
      },
      { orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }] as never },
    )
    return { tasks: await mapTasks(em, scope, rows) }
  }

  async memberTasks(
    em: EntityManager,
    scope: TasksScope,
    actorId: string,
    targetUserId: string,
    query: TeamTasksQuery,
  ): Promise<PagedResponse<TaskListItemDto>> {
    await this.assertCanView(em, scope, actorId, targetUserId)
    const emptyPage = { items: [], page: query.page, pageSize: query.pageSize, total: 0, totalPages: 1 }

    const [liveProjectIds, assignedIds] = await Promise.all([
      loadLiveProjectIds(em, scope),
      loadAssignedTaskIds(em, scope, targetUserId),
    ])
    if (liveProjectIds.length === 0 || assignedIds.length === 0) return emptyPage

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

    const [rows, total] = await em.findAndCount(TasksTask, { $and: filters } as never, {
      orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }, { id: 'desc' }] as never,
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

  private async assertCanView(
    em: EntityManager,
    scope: TasksScope,
    actorId: string,
    targetUserId: string,
  ): Promise<void> {
    if (actorId === targetUserId) return
    const people = await listScopedUsers(em, scope)
    if (!people.some((person) => person.id === targetUserId)) {
      const messages = await loadTasksMessages()
      throw forbidden(messages.teamMemberForbidden)
    }
  }
}

/** Outstanding tasks per person, counting both direct assignment and role
 *  audiences, deduplicated so a task assigned twice over counts once. */
async function loadOpenTaskCounts(
  em: EntityManager,
  scope: TasksScope,
  userIds: readonly string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (userIds.length === 0) return result

  const db = em.getKysely<any>() as any
  const openTask = (query: any) =>
    query
      .where('tasks_tasks.archived_at', 'is', null)
      .where('tasks_tasks.deleted_at', 'is', null)
      .where('tasks_tasks.status', 'not in', [...TASK_TERMINAL_STATUSES])
      .where('tasks_tasks.tenant_id', '=', scope.tenantId)
      .where('tasks_tasks.organization_id', '=', scope.organizationId)

  const directRows = (await openTask(
    db
      .selectFrom('tasks_task_assignees')
      .innerJoin('tasks_tasks', 'tasks_tasks.id', 'tasks_task_assignees.task_id')
      .select(['tasks_task_assignees.user_id as user_id', 'tasks_task_assignees.task_id as task_id'])
      .where('tasks_task_assignees.user_id', 'in', [...userIds]),
  ).execute()) as Array<{ user_id: string; task_id: string }>

  const roleRows = (await openTask(
    db
      .selectFrom('tasks_task_assignment_targets')
      .innerJoin('tasks_tasks', 'tasks_tasks.id', 'tasks_task_assignment_targets.task_id')
      .innerJoin('user_roles', 'user_roles.role_id', 'tasks_task_assignment_targets.role_id')
      .select(['user_roles.user_id as user_id', 'tasks_task_assignment_targets.task_id as task_id'])
      .where('user_roles.user_id', 'in', [...userIds])
      .where('user_roles.deleted_at', 'is', null),
  ).execute()) as Array<{ user_id: string; task_id: string }>

  const byUser = new Map<string, Set<string>>()
  for (const row of [...directRows, ...roleRows]) {
    const bucket = byUser.get(row.user_id) ?? new Set<string>()
    bucket.add(row.task_id)
    byUser.set(row.user_id, bucket)
  }
  for (const [userId, taskIds] of byUser) result.set(userId, taskIds.size)
  return result
}
