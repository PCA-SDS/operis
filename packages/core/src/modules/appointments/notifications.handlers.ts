import type { NotificationHandler } from '@open-mercato/shared/modules/notifications/handler'

function interpolate(text: string | undefined, variables: Record<string, string> | null | undefined): string | undefined {
  if (!text) return text
  return Object.entries(variables ?? {}).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    text,
  )
}

export const notificationHandlers: NotificationHandler[] = [
  {
    id: 'appointments.appointment-created.toast',
    notificationType: 'appointments.appointment.created',
    priority: 100,
    handle(notification, context) {
      if (notification.bodyKey && !notification.bodyVariables?.customerName) return

      const body = notification.bodyKey
        ? context.t?.(notification.bodyKey, notification.body ?? undefined) ?? notification.body ?? undefined
        : notification.body ?? undefined

      context.toast({
        title: interpolate(body, notification.bodyVariables) ?? notification.title,
        severity: 'info',
        duration: 5000,
        action: {
          label: context.t?.(
            'appointments.notifications.appointment.created.view',
            'View appointment',
          ) ?? 'View appointment',
          onClick: () => {
            if (notification.linkHref) context.navigate(notification.linkHref)
          },
        },
      })
    },
  },
]

export default notificationHandlers
