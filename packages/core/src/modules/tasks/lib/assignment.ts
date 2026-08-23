// Who a task belongs to. A task can name people directly (`tasks_task_assignees`)
// and/or name a role audience (`tasks_task_assignment_targets`) whose current
// members are resolved at read time — so adding someone to a role hands them
// every task that role owns, without rewriting a single task row.

import type { EntityManager } from '@mikro-orm/postgresql'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { Role, User } from '../../auth/data/entities'
import { TASK_MAX_ASSIGNMENT_TARGETS } from '../data/types'
import { loadRoleIdsForUser, type TasksScope } from './people'

export type NormalizedAssignmentTarget = {
  kind: 'role'
  roleId: string
}

export type AssignmentTargetInput = {
  kind: string
  roleId?: string | null
}

/**
 * Reject any user id that is not assignable inside this scope — the guard that
 * stops a task being handed to somebody in another tenant or organization.
 * Mirrors `listScopedUsers`: the organization's own users plus tenant-level
 * users who carry no organization.
 */
export async function assertScopedUserIds(
  em: EntityManager,
  scope: TasksScope,
  ids: readonly (string | null | undefined)[],
  message: string,
): Promise<string[]> {
  const unique = [...new Set(ids)].filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (unique.length === 0) return []
  const found = await em.find(
    User,
    {
      id: { $in: unique },
      tenantId: scope.tenantId,
      deletedAt: null,
      $or: [{ organizationId: scope.organizationId }, { organizationId: null }],
    },
    { fields: ['id'] },
  )
  if (found.length !== unique.length) throw badRequest(message)
  return unique
}

export async function assertScopedRoleIds(
  em: EntityManager,
  scope: TasksScope,
  ids: readonly string[],
  message: string,
): Promise<void> {
  if (ids.length === 0) return
  const found = await em.find(
    Role,
    { id: { $in: [...ids] }, tenantId: scope.tenantId, deletedAt: null },
    { fields: ['id'] },
  )
  if (found.length !== ids.length) throw badRequest(message)
}

export async function normalizeAssignmentTargets(
  em: EntityManager,
  scope: TasksScope,
  targets: readonly AssignmentTargetInput[] | undefined,
  messages: { tooMany: string; missingRole: string; unknownKind: string; unknownRole: string },
): Promise<NormalizedAssignmentTarget[]> {
  if (!targets || targets.length === 0) return []
  if (targets.length > TASK_MAX_ASSIGNMENT_TARGETS) throw badRequest(messages.tooMany)

  const roleIds = new Set<string>()
  for (const target of targets) {
    if (target.kind !== 'role') throw badRequest(messages.unknownKind)
    if (!target.roleId) throw badRequest(messages.missingRole)
    roleIds.add(target.roleId)
  }
  await assertScopedRoleIds(em, scope, [...roleIds], messages.unknownRole)
  return [...roleIds].map((roleId) => ({ kind: 'role' as const, roleId }))
}

/**
 * Every task id currently assigned to `userId`, directly or through one of
 * their roles. Materialised (rather than expressed as a SQL subquery) because
 * the ORM filter that consumes it cannot take one; the set is bounded by one
 * person's workload, and the two source tables are indexed on the columns
 * filtered here.
 */
export async function loadAssignedTaskIds(
  em: EntityManager,
  scope: TasksScope,
  userId: string,
): Promise<string[]> {
  const roleIds = await loadRoleIdsForUser(em, userId)
  const db = em.getKysely<any>() as any

  const direct = db
    .selectFrom('tasks_task_assignees')
    .select('task_id')
    .where('user_id', '=', userId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)

  const query =
    roleIds.length > 0
      ? direct.union(
          db
            .selectFrom('tasks_task_assignment_targets')
            .select('task_id')
            .where('role_id', 'in', roleIds)
            .where('tenant_id', '=', scope.tenantId)
            .where('organization_id', '=', scope.organizationId),
        )
      : direct

  const rows = (await query.execute()) as Array<{ task_id: string }>
  return [...new Set(rows.map((row) => row.task_id))]
}
