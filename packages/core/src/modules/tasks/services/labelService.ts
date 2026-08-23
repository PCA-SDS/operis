import type { EntityManager } from '@mikro-orm/postgresql'
import { assertFound, badRequest } from '@open-mercato/shared/lib/crud/errors'
import { TasksLabel } from '../data/entities'
import type { LabelDto } from '../data/types'
import { isoInstant } from '../lib/values'
import type { TasksScope } from '../lib/people'
import { loadTasksMessages } from '../lib/messages'

export interface LabelService {
  list(em: EntityManager, scope: TasksScope): Promise<LabelDto[]>
  requireLabel(em: EntityManager, scope: TasksScope, id: string): Promise<TasksLabel>
  assertScopedLabelIds(em: EntityManager, scope: TasksScope, ids: readonly string[]): Promise<string[]>
}

export class DefaultLabelService implements LabelService {
  async list(em: EntityManager, scope: TasksScope): Promise<LabelDto[]> {
    const rows = await em.find(
      TasksLabel,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      { orderBy: { name: 'asc' } },
    )
    const counts = await loadLabelTaskCounts(em, scope, rows.map((row) => row.id))
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      taskCount: counts.get(row.id) ?? 0,
      updatedAt: isoInstant(row.updatedAt ?? row.createdAt) ?? '',
    }))
  }

  async requireLabel(em: EntityManager, scope: TasksScope, id: string): Promise<TasksLabel> {
    const messages = await loadTasksMessages()
    return assertFound(
      await em.findOne(TasksLabel, {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      }),
      messages.labelNotFound,
    )
  }

  /** Reject label ids from another scope before they reach a task — a label is
   *  a scope-level catalog entry, and a task must never point outside its own. */
  async assertScopedLabelIds(
    em: EntityManager,
    scope: TasksScope,
    ids: readonly string[],
  ): Promise<string[]> {
    const unique = [...new Set(ids)].filter((id) => typeof id === 'string' && id.length > 0)
    if (unique.length === 0) return []
    const found = await em.find(
      TasksLabel,
      {
        id: { $in: unique },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      { fields: ['id'] },
    )
    if (found.length !== unique.length) {
      const messages = await loadTasksMessages()
      throw badRequest(messages.unknownLabels)
    }
    return unique
  }
}

async function loadLabelTaskCounts(
  em: EntityManager,
  scope: TasksScope,
  labelIds: readonly string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (labelIds.length === 0) return result
  const db = em.getKysely<any>() as any
  const rows = (await db
    .selectFrom('tasks_task_labels')
    .innerJoin('tasks_tasks', 'tasks_tasks.id', 'tasks_task_labels.task_id')
    .select(['tasks_task_labels.label_id as label_id'])
    .select((eb: any) => eb.fn.countAll().as('count'))
    .where('tasks_task_labels.label_id', 'in', [...labelIds])
    .where('tasks_tasks.tenant_id', '=', scope.tenantId)
    .where('tasks_tasks.organization_id', '=', scope.organizationId)
    .where('tasks_tasks.archived_at', 'is', null)
    .where('tasks_tasks.deleted_at', 'is', null)
    .groupBy('tasks_task_labels.label_id')
    .execute()) as Array<{ label_id: string; count: string | number }>
  for (const row of rows) result.set(row.label_id, Number(row.count))
  return result
}
