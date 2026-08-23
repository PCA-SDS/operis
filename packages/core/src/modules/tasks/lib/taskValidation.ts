// Relationship guards shared by the task create and update commands. Each one
// answers a single question the client is not allowed to get wrong: does this
// milestone / parent / project actually belong where the caller says it does.

import type { EntityManager } from '@mikro-orm/postgresql'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { TasksMilestone, TasksTask } from '../data/entities'
import type { TasksScope } from './people'
import type { TasksMessages } from './messages'

export async function assertMilestoneInProject(
  em: EntityManager,
  scope: TasksScope,
  projectId: string,
  milestoneId: string,
  messages: TasksMessages,
): Promise<void> {
  const milestone = await em.findOne(
    TasksMilestone,
    {
      id: milestoneId,
      projectId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { fields: ['id'] },
  )
  if (!milestone) throw badRequest(messages.milestoneWrongProject)
}

export async function assertTaskInProject(
  em: EntityManager,
  scope: TasksScope,
  projectId: string,
  taskId: string,
  messages: TasksMessages,
): Promise<void> {
  const task = await em.findOne(
    TasksTask,
    {
      id: taskId,
      projectId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { fields: ['id'] },
  )
  if (!task) throw badRequest(messages.parentWrongProject)
}

/**
 * Reject a re-parent that would make a task its own ancestor. Walks the
 * proposed parent's chain upward; the loop is bounded by the project's task
 * count so corrupt data cannot spin forever.
 */
export async function assertNoSubtaskCycle(
  em: EntityManager,
  scope: TasksScope,
  projectId: string,
  taskId: string,
  newParentId: string,
  messages: TasksMessages,
): Promise<void> {
  if (newParentId === taskId) throw badRequest(messages.parentIsSelf)

  const rows = await em.find(
    TasksTask,
    {
      projectId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { fields: ['id', 'parentTaskId'] },
  )
  const parentOf = new Map(rows.map((row) => [row.id, row.parentTaskId ?? null]))

  let cursor: string | null = newParentId
  for (let step = 0; step <= rows.length && cursor !== null; step++) {
    if (cursor === taskId) throw badRequest(messages.parentIsDescendant)
    cursor = parentOf.get(cursor) ?? null
  }
}

/** Same guard for the doc tree — a page must not end up under its own child. */
export async function assertNoDocCycle(
  parentOf: Map<string, string | null>,
  docId: string,
  newParentId: string,
  messages: TasksMessages,
): Promise<void> {
  if (newParentId === docId) throw badRequest(messages.docIsDescendant)
  let cursor: string | null = newParentId
  for (let step = 0; step <= parentOf.size && cursor !== null; step++) {
    if (cursor === docId) throw badRequest(messages.docIsDescendant)
    cursor = parentOf.get(cursor) ?? null
  }
}
