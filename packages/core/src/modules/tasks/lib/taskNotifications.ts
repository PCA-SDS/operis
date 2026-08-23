import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { notificationTypes } from '../notifications'
import { loadUserIdsByRoleIds } from './people'

const logger = createLogger('tasks').child({ component: 'notifications' })

export type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve<T = unknown>(name: string): T }
}

export type TaskNotificationScope = {
  tenantId: string | null
  organizationId: string | null
}

/**
 * Deliver one notification type to a set of people.
 *
 * Nobody is notified about their own action — being told you assigned a task to
 * yourself is noise, and it is the single most common way a notification system
 * loses trust. Role audiences are expanded here rather than at write time so a
 * role's current members receive it.
 */
export async function notifyTaskAudience(
  ctx: ResolverContext,
  options: {
    type: string
    scope: TaskNotificationScope
    userIds: readonly string[]
    roleIds?: readonly string[]
    actorUserId?: string | null
    bodyVariables: Record<string, string>
    sourceEntityId: string
    linkHref: string
  },
): Promise<void> {
  if (!options.scope.tenantId) return

  const typeDefinition = notificationTypes.find((entry) => entry.type === options.type)
  if (!typeDefinition) return

  const container = ctx.container ?? { resolve: ctx.resolve }

  let notificationService: ReturnType<typeof resolveNotificationService> | null = null
  try {
    notificationService = resolveNotificationService(container)
  } catch (error) {
    logger.warn('notificationService resolve failed', { type: options.type, err: error })
    return
  }

  const recipients = new Set(options.userIds.filter(Boolean))
  if (options.roleIds?.length) {
    try {
      const em = container.resolve<EntityManager>('em')
      const byRole = await loadUserIdsByRoleIds(em, options.roleIds)
      for (const userIds of byRole.values()) {
        for (const userId of userIds) recipients.add(userId)
      }
    } catch (error) {
      logger.warn('Role audience expansion failed', { type: options.type, err: error })
    }
  }
  if (options.actorUserId) recipients.delete(options.actorUserId)
  if (recipients.size === 0) return

  for (const recipientUserId of recipients) {
    const input = buildNotificationFromType(typeDefinition, {
      recipientUserId,
      bodyVariables: options.bodyVariables,
      sourceEntityType: 'tasks:tasks_task',
      sourceEntityId: options.sourceEntityId,
      linkHref: options.linkHref,
    })
    try {
      await notificationService.create(input, {
        tenantId: options.scope.tenantId,
        organizationId: options.scope.organizationId ?? null,
      })
    } catch (error) {
      // One failed recipient must not stop the rest.
      logger.warn('Notification create failed', { type: options.type, recipientUserId, err: error })
    }
  }
}
