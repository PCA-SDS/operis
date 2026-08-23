import type { EntityManager } from '@mikro-orm/postgresql'
import { assertFound } from '@open-mercato/shared/lib/crud/errors'
import { TasksMilestone } from '../data/entities'
import type { MilestoneDto } from '../data/types'
import { isoDate, isoInstant } from '../lib/values'
import type { TasksScope } from '../lib/people'
import { loadTasksMessages } from '../lib/messages'

export interface MilestoneService {
  listByProject(em: EntityManager, scope: TasksScope, projectId: string): Promise<MilestoneDto[]>
  requireMilestone(em: EntityManager, scope: TasksScope, id: string): Promise<TasksMilestone>
}

export class DefaultMilestoneService implements MilestoneService {
  async listByProject(
    em: EntityManager,
    scope: TasksScope,
    projectId: string,
  ): Promise<MilestoneDto[]> {
    const rows = await em.find(
      TasksMilestone,
      {
        projectId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      { orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] as never },
    )
    const counts = await loadMilestoneTaskCounts(em, scope, rows.map((row) => row.id))
    return rows.map((row) => toMilestoneDto(row, counts.get(row.id)))
  }

  async requireMilestone(
    em: EntityManager,
    scope: TasksScope,
    id: string,
  ): Promise<TasksMilestone> {
    const messages = await loadTasksMessages()
    return assertFound(
      await em.findOne(TasksMilestone, {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      }),
      messages.milestoneNotFound,
    )
  }
}

export type MilestoneTaskCounts = { total: number; done: number }

/** Milestone progress is derived, never stored — a task moving to done must not
 *  need a second write to keep a counter honest. */
export async function loadMilestoneTaskCounts(
  em: EntityManager,
  scope: TasksScope,
  milestoneIds: readonly string[],
): Promise<Map<string, MilestoneTaskCounts>> {
  const result = new Map<string, MilestoneTaskCounts>()
  if (milestoneIds.length === 0) return result
  const db = em.getKysely<any>() as any
  const rows = (await db
    .selectFrom('tasks_tasks')
    .select(['milestone_id', 'status'])
    .select((eb: any) => eb.fn.countAll().as('count'))
    .where('milestone_id', 'in', [...milestoneIds])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('archived_at', 'is', null)
    .where('deleted_at', 'is', null)
    .groupBy(['milestone_id', 'status'])
    .execute()) as Array<{ milestone_id: string; status: string; count: string | number }>
  for (const row of rows) {
    const bucket = result.get(row.milestone_id) ?? { total: 0, done: 0 }
    const count = Number(row.count)
    bucket.total += count
    if (row.status === 'done') bucket.done += count
    result.set(row.milestone_id, bucket)
  }
  return result
}

export function toMilestoneDto(
  milestone: TasksMilestone,
  counts: MilestoneTaskCounts | undefined,
): MilestoneDto {
  const total = counts?.total ?? 0
  const done = counts?.done ?? 0
  return {
    id: milestone.id,
    projectId: milestone.projectId,
    name: milestone.name,
    description: milestone.description ?? null,
    status: milestone.status,
    dueDate: isoDate(milestone.dueDate),
    taskCount: total,
    doneTaskCount: done,
    progress: total === 0 ? 0 : Math.round((done / total) * 100),
    createdAt: isoInstant(milestone.createdAt) ?? '',
    updatedAt: isoInstant(milestone.updatedAt ?? milestone.createdAt) ?? '',
  }
}
