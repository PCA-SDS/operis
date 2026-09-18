import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'appointments.appointment.created',
    module: 'appointments',
    titleKey: 'appointments.notifications.appointment.created.title',
    bodyKey: 'appointments.notifications.appointment.created.body',
    icon: 'calendar-plus',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'appointments.notifications.appointment.created.view',
        variant: 'outline',
        href: '/backend/appointments/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/appointments/{sourceEntityId}',
    expiresAfterHours: 72,
  },
]

export default notificationTypes
