import { notifyTaskAudience, type ResolverContext } from '../lib/taskNotifications'

export const metadata = {
  event: 'tasks.task.assigned',
  persistent: true,
  id: 'tasks:task-assigned-notification',
}

type TaskAssignedPayload = {
  id: string
  tenantId: string | null
  organizationId: string | null
  title: string
  assigneeIds?: string[]
  roleIds?: string[]
  actorUserId?: string | null
}

export default async function handleTaskAssigned(
  payload: TaskAssignedPayload,
  ctx: ResolverContext,
): Promise<void> {
  if (!payload?.id) return
  await notifyTaskAudience(ctx, {
    type: 'tasks.task.assigned',
    scope: { tenantId: payload.tenantId ?? null, organizationId: payload.organizationId ?? null },
    userIds: payload.assigneeIds ?? [],
    roleIds: payload.roleIds ?? [],
    actorUserId: payload.actorUserId ?? null,
    bodyVariables: { taskTitle: payload.title ?? '' },
    sourceEntityId: payload.id,
    linkHref: '/backend/tasks/assigned',
  })
}
