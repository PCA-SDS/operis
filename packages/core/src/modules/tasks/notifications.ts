import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * What the module tells people about. Deliberately narrow: work management
 * generates a lot of writes, and a notification for each would train everyone
 * to ignore the bell. Only the three that change what someone should do next
 * are here.
 */
export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'tasks.task.assigned',
    // Ships without push — operators re-enable it per type from the
    // Notification Delivery settings.
    channels: ['in_app'],
    module: 'tasks',
    titleKey: 'tasks.notifications.assigned.title',
    bodyKey: 'tasks.notifications.assigned.body',
    icon: 'user-check',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/tasks/assigned',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/tasks/assigned',
    expiresAfterHours: 168,
  },
  {
    type: 'tasks.task.commented',
    channels: ['in_app'],
    module: 'tasks',
    titleKey: 'tasks.notifications.commented.title',
    bodyKey: 'tasks.notifications.commented.body',
    icon: 'message-square',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/tasks/assigned',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/tasks/assigned',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
