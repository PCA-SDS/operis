import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { TasksTask, TasksTaskAssignee, TasksTaskAssignmentTarget, TasksTaskComment } from '../data/entities'
import { notifyTaskAudience, type ResolverContext } from '../lib/taskNotifications'

const logger = createLogger('tasks').child({ component: 'commentNotification' })

export const metadata = {
  event: 'tasks.comment.created',
  persistent: true,
  id: 'tasks:task-comment-notification',
}

type CommentCreatedPayload = {
  id: string
  tenantId: string | null
  organizationId: string | null
}

/**
 * Tell a task's people that it was discussed.
 *
 * The CRUD event carries only ids, so the audience is read here rather than
 * widening the event contract for one subscriber. Everyone on the task hears
 * about it — including the reviewer, who is usually the person waiting on the
 * answer — except whoever wrote the comment.
 */
export default async function handleTaskComment(
  payload: CommentCreatedPayload,
  ctx: ResolverContext,
): Promise<void> {
  if (!payload?.id || !payload.tenantId) return
  const container = ctx.container ?? { resolve: ctx.resolve }

  let em: EntityManager
  try {
    em = container.resolve<EntityManager>('em')
  } catch (error) {
    logger.warn('em resolve failed', { err: error })
    return
  }

  const comment = await em.findOne(TasksTaskComment, { id: payload.id })
  if (!comment) return

  const task = await em.findOne(TasksTask, { id: comment.taskId, deletedAt: null })
  if (!task) return

  const [assignees, targets] = await Promise.all([
    em.find(TasksTaskAssignee, { taskId: task.id }),
    em.find(TasksTaskAssignmentTarget, { taskId: task.id }),
  ])

  const userIds = new Set(assignees.map((row) => row.userId))
  if (task.reviewerUserId) userIds.add(task.reviewerUserId)
  if (task.reporterUserId) userIds.add(task.reporterUserId)

  await notifyTaskAudience(ctx, {
    type: 'tasks.task.commented',
    scope: { tenantId: task.tenantId, organizationId: task.organizationId },
    userIds: [...userIds],
    roleIds: targets.map((row) => row.roleId),
    actorUserId: comment.authorUserId ?? null,
    bodyVariables: { taskTitle: task.title },
    sourceEntityId: task.id,
    linkHref: '/backend/tasks/assigned',
  })
}
