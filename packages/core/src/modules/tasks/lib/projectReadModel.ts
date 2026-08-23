import type { EntityManager } from '@mikro-orm/postgresql'
import { TasksProject, TasksProjectMember } from '../data/entities'
import type { ProjectDetailDto, ProjectListItemDto, ProjectMemberDto } from '../data/types'
import { isoDate, isoInstant } from './values'
import { loadPeopleByIds, toTaskUser, type TasksScope } from './people'

export type ProjectTaskCounts = { total: number; open: number }

/** Task totals per project, split by "still outstanding". Aggregated in SQL —
 *  a project list must not pull every task row to count them. */
export async function loadProjectTaskCounts(
  em: EntityManager,
  scope: TasksScope,
  projectIds: readonly string[],
): Promise<Map<string, ProjectTaskCounts>> {
  const result = new Map<string, ProjectTaskCounts>()
  if (projectIds.length === 0) return result
  const db = em.getKysely<any>() as any
  const rows = await db
    .selectFrom('tasks_tasks')
    .select(['project_id', 'status'])
    .select((eb: any) => eb.fn.countAll().as('count'))
    .where('project_id', 'in', [...projectIds])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('archived_at', 'is', null)
    .where('deleted_at', 'is', null)
    .groupBy(['project_id', 'status'])
    .execute()
  for (const row of rows as Array<{ project_id: string; status: string; count: string | number }>) {
    const bucket = result.get(row.project_id) ?? { total: 0, open: 0 }
    const count = Number(row.count)
    bucket.total += count
    if (row.status !== 'done' && row.status !== 'cancelled') bucket.open += count
    result.set(row.project_id, bucket)
  }
  return result
}

export async function loadProjectMemberIds(
  em: EntityManager,
  scope: TasksScope,
  projectIds: readonly string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (projectIds.length === 0) return result
  const rows = await em.find(TasksProjectMember, {
    projectId: { $in: [...projectIds] },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  for (const row of rows) {
    const bucket = result.get(row.projectId)
    if (bucket) bucket.push(row.userId)
    else result.set(row.projectId, [row.userId])
  }
  return result
}

export type ProjectHydrationContext = {
  counts: Map<string, ProjectTaskCounts>
  memberIds: Map<string, string[]>
  people: Map<string, { id: string; name: string; email: string }>
}

export async function buildProjectHydrationContext(
  em: EntityManager,
  scope: TasksScope,
  projects: readonly TasksProject[],
): Promise<ProjectHydrationContext> {
  const ids = projects.map((project) => project.id)
  const [counts, memberIds] = await Promise.all([
    loadProjectTaskCounts(em, scope, ids),
    loadProjectMemberIds(em, scope, ids),
  ])
  const personIds = [
    ...projects.map((project) => project.ownerUserId).filter((id): id is string => !!id),
    ...[...memberIds.values()].flat(),
  ]
  const people = await loadPeopleByIds(em, scope, personIds)
  return { counts, memberIds, people }
}

export function toProjectListItemDto(
  project: TasksProject,
  ctx: ProjectHydrationContext,
): ProjectListItemDto {
  const counts = ctx.counts.get(project.id) ?? { total: 0, open: 0 }
  const memberIds = ctx.memberIds.get(project.id) ?? []
  return {
    id: project.id,
    key: project.key,
    name: project.name,
    description: project.description ?? null,
    icon: project.icon,
    owner: toTaskUser(project.ownerUserId ? ctx.people.get(project.ownerUserId) : null),
    startDate: isoDate(project.startDate),
    memberCount: memberIds.length,
    taskCount: counts.total,
    openTaskCount: counts.open,
    isInbox: project.isInbox,
    archivedAt: isoInstant(project.archivedAt),
    createdAt: isoInstant(project.createdAt) ?? '',
    updatedAt: isoInstant(project.updatedAt ?? project.createdAt) ?? '',
  }
}

export function toProjectDetailDto(
  project: TasksProject,
  ctx: ProjectHydrationContext,
): ProjectDetailDto {
  const memberIds = ctx.memberIds.get(project.id) ?? []
  const members: ProjectMemberDto[] = memberIds
    .map((id) => ctx.people.get(id))
    .filter((person): person is NonNullable<typeof person> => !!person)
    .map((person) => ({ id: person.id, name: person.name, email: person.email }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { ...toProjectListItemDto(project, ctx), members }
}
