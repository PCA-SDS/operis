// Turning task rows into the wire DTO. Everything a card shows — project ref,
// parent breadcrumb, subtask counter, assignees, role audiences, labels,
// comment count — lives in a different table, so this hydrates a whole page of
// tasks in a fixed number of batch queries instead of one set per row.

import type { EntityManager } from '@mikro-orm/postgresql'
import {
  TasksLabel,
  TasksMilestone,
  TasksProject,
  TasksTask,
  TasksTaskAssignee,
  TasksTaskAssignmentTarget,
  TasksTaskLabel,
} from '../data/entities'
import type {
  LabelDto,
  TaskAssignmentTargetDto,
  TaskDetailDto,
  TaskListItemDto,
  TaskParentRefDto,
} from '../data/types'
import { isoDate, isoInstant } from './values'
import { toRecurrenceDto } from './recurrence'
import { loadPeopleByIds, loadRolesByIds, toTaskUser, type PersonRow, type TasksScope } from './people'

export type TaskHydrationContext = {
  projects: Map<string, TasksProject>
  parents: Map<string, TaskParentRefDto>
  subtaskCounts: Map<string, { total: number; done: number }>
  assigneesByTask: Map<string, string[]>
  targetsByTask: Map<string, string[]>
  labelsByTask: Map<string, LabelDto[]>
  commentCounts: Map<string, number>
  milestones: Map<string, string>
  people: Map<string, PersonRow>
  roles: Map<string, { id: string; name: string }>
}

function toLabelDto(label: TasksLabel): LabelDto {
  return {
    id: label.id,
    name: label.name,
    color: label.color,
    taskCount: 0,
    updatedAt: isoInstant(label.updatedAt ?? label.createdAt) ?? '',
  }
}

/**
 * Load everything the given tasks reference. `extraProjects` lets the caller
 * pre-seed a project it already has in hand (the board and the project task
 * list always do), saving a round trip.
 */
export async function buildTaskHydrationContext(
  em: EntityManager,
  scope: TasksScope,
  tasks: readonly TasksTask[],
  extraProjects: readonly TasksProject[] = [],
): Promise<TaskHydrationContext> {
  const empty: TaskHydrationContext = {
    projects: new Map(),
    parents: new Map(),
    subtaskCounts: new Map(),
    assigneesByTask: new Map(),
    targetsByTask: new Map(),
    labelsByTask: new Map(),
    commentCounts: new Map(),
    milestones: new Map(),
    people: new Map(),
    roles: new Map(),
  }
  for (const project of extraProjects) empty.projects.set(project.id, project)
  if (tasks.length === 0) return empty

  const taskIds = tasks.map((task) => task.id)
  const projectIds = [...new Set(tasks.map((task) => task.projectId))].filter(
    (id) => !empty.projects.has(id),
  )
  const parentIds = [...new Set(tasks.map((task) => task.parentTaskId).filter((id): id is string => !!id))]
  const milestoneIds = [...new Set(tasks.map((task) => task.milestoneId).filter((id): id is string => !!id))]

  const scopeFilter = { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }

  const [projectRows, parentRows, subtaskRows, assigneeRows, targetRows, taskLabelRows, milestoneRows] =
    await Promise.all([
      projectIds.length
        ? em.find(TasksProject, { id: { $in: projectIds }, ...scopeFilter })
        : Promise.resolve([] as TasksProject[]),
      parentIds.length
        ? em.find(TasksTask, { id: { $in: parentIds }, ...scopeFilter })
        : Promise.resolve([] as TasksTask[]),
      em.find(TasksTask, { parentTaskId: { $in: taskIds }, ...scopeFilter }),
      em.find(TasksTaskAssignee, { taskId: { $in: taskIds }, tenantId: scope.tenantId, organizationId: scope.organizationId }),
      em.find(TasksTaskAssignmentTarget, { taskId: { $in: taskIds }, tenantId: scope.tenantId, organizationId: scope.organizationId }),
      em.find(TasksTaskLabel, { taskId: { $in: taskIds }, tenantId: scope.tenantId, organizationId: scope.organizationId }),
      milestoneIds.length
        ? em.find(TasksMilestone, { id: { $in: milestoneIds }, ...scopeFilter })
        : Promise.resolve([] as TasksMilestone[]),
    ])

  for (const project of projectRows) empty.projects.set(project.id, project)
  for (const parent of parentRows) {
    empty.parents.set(parent.id, {
      id: parent.id,
      number: parent.number,
      title: parent.title,
      status: parent.status,
    })
  }
  for (const milestone of milestoneRows) empty.milestones.set(milestone.id, milestone.name)

  // Cancelled subtasks are excluded from both halves of the "1/3" counter — a
  // cancelled child is not outstanding work, and counting it as done would
  // report progress nobody made.
  for (const subtask of subtaskRows) {
    if (!subtask.parentTaskId || subtask.status === 'cancelled') continue
    const bucket = empty.subtaskCounts.get(subtask.parentTaskId) ?? { total: 0, done: 0 }
    bucket.total += 1
    if (subtask.status === 'done') bucket.done += 1
    empty.subtaskCounts.set(subtask.parentTaskId, bucket)
  }

  for (const row of assigneeRows) {
    const bucket = empty.assigneesByTask.get(row.taskId)
    if (bucket) bucket.push(row.userId)
    else empty.assigneesByTask.set(row.taskId, [row.userId])
  }
  for (const row of targetRows) {
    const bucket = empty.targetsByTask.get(row.taskId)
    if (bucket) bucket.push(row.roleId)
    else empty.targetsByTask.set(row.taskId, [row.roleId])
  }

  const labelIds = [...new Set(taskLabelRows.map((row) => row.labelId))]
  const labelRows = labelIds.length
    ? await em.find(TasksLabel, { id: { $in: labelIds }, ...scopeFilter }, { orderBy: { name: 'asc' } })
    : []
  const labelsById = new Map(labelRows.map((label) => [label.id, toLabelDto(label)]))
  for (const row of taskLabelRows) {
    const label = labelsById.get(row.labelId)
    if (!label) continue
    const bucket = empty.labelsByTask.get(row.taskId)
    if (bucket) bucket.push(label)
    else empty.labelsByTask.set(row.taskId, [label])
  }
  for (const labels of empty.labelsByTask.values()) labels.sort((a, b) => a.name.localeCompare(b.name))

  empty.commentCounts = await loadCommentCounts(em, scope, taskIds)

  const personIds = [
    ...tasks.map((task) => task.reviewerUserId),
    ...tasks.map((task) => task.reporterUserId),
    ...assigneeRows.map((row) => row.userId),
  ].filter((id): id is string => !!id)
  const [people, roles] = await Promise.all([
    loadPeopleByIds(em, scope, personIds),
    loadRolesByIds(em, targetRows.map((row) => row.roleId)),
  ])
  empty.people = people
  empty.roles = roles

  return empty
}

/** Grouped comment counts. Aggregated in SQL rather than fetched and counted,
 *  because a chatty task can carry thousands of rows. */
async function loadCommentCounts(
  em: EntityManager,
  scope: TasksScope,
  taskIds: readonly string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (taskIds.length === 0) return result
  const db = em.getKysely<any>() as any
  const rows = await db
    .selectFrom('tasks_task_comments')
    .select(['task_id'])
    .select((eb: any) => eb.fn.countAll().as('count'))
    .where('task_id', 'in', [...taskIds])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .groupBy('task_id')
    .execute()
  for (const row of rows as Array<{ task_id: string; count: string | number }>) {
    result.set(row.task_id, Number(row.count))
  }
  return result
}

export function toTaskListItemDto(task: TasksTask, ctx: TaskHydrationContext): TaskListItemDto {
  const project = ctx.projects.get(task.projectId)
  const subtasks = ctx.subtaskCounts.get(task.id) ?? { total: 0, done: 0 }
  const assigneeIds = ctx.assigneesByTask.get(task.id) ?? []
  const targetRoleIds = ctx.targetsByTask.get(task.id) ?? []

  const assignees = assigneeIds
    .map((id) => toTaskUser(ctx.people.get(id)))
    .filter((user): user is NonNullable<typeof user> => user !== null)
    .sort((a, b) => a.name.localeCompare(b.name))

  const assignmentTargets: TaskAssignmentTargetDto[] = targetRoleIds
    .map((roleId) => ctx.roles.get(roleId))
    .filter((role): role is { id: string; name: string } => !!role)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((role) => ({ kind: 'role' as const, role }))

  return {
    id: task.id,
    projectId: task.projectId,
    projectKey: project?.key ?? '',
    projectName: project?.name ?? '',
    projectIcon: project?.icon ?? '',
    parentTaskId: task.parentTaskId ?? null,
    parent: task.parentTaskId ? (ctx.parents.get(task.parentTaskId) ?? null) : null,
    subtaskCount: subtasks.total,
    subtaskDoneCount: subtasks.done,
    number: task.number,
    title: task.title,
    status: task.status,
    priority: task.priority,
    assignees,
    assignmentTargets,
    reviewer: toTaskUser(task.reviewerUserId ? ctx.people.get(task.reviewerUserId) : null),
    milestoneId: task.milestoneId ?? null,
    milestoneName: task.milestoneId ? (ctx.milestones.get(task.milestoneId) ?? null) : null,
    dueDate: isoDate(task.dueDate),
    dueTime: task.dueTime ?? null,
    recurrence: toRecurrenceDto(task),
    completedAt: isoInstant(task.completedAt),
    rank: task.rank,
    commentCount: ctx.commentCounts.get(task.id) ?? 0,
    labels: ctx.labelsByTask.get(task.id) ?? [],
    createdAt: isoInstant(task.createdAt) ?? '',
    updatedAt: isoInstant(task.updatedAt ?? task.createdAt) ?? '',
  }
}

export function toTaskDetailDto(
  task: TasksTask,
  ctx: TaskHydrationContext,
  subtasks: readonly TasksTask[],
  subtaskCtx: TaskHydrationContext,
): TaskDetailDto {
  return {
    ...toTaskListItemDto(task, ctx),
    reporter: toTaskUser(task.reporterUserId ? ctx.people.get(task.reporterUserId) : null),
    description: task.description,
    descriptionPlaintext: task.descriptionPlaintext,
    subtasks: subtasks.map((subtask) => toTaskListItemDto(subtask, subtaskCtx)),
  }
}

/** Hydrate + map in one call — the shape every list endpoint needs. */
export async function mapTasks(
  em: EntityManager,
  scope: TasksScope,
  tasks: readonly TasksTask[],
  extraProjects: readonly TasksProject[] = [],
): Promise<TaskListItemDto[]> {
  const ctx = await buildTaskHydrationContext(em, scope, tasks, extraProjects)
  return tasks.map((task) => toTaskListItemDto(task, ctx))
}
