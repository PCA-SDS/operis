'use client'

import * as React from 'react'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'
import { useAppEvent } from '../injection/useAppEvent'
import { subscribeNotificationEffects } from './NotificationDispatcher'
import { matchesType } from './matchesType'

const NOTIFICATION_CREATED_EVENT = 'notifications.notification.created'
const MAX_SEEN_IDS = 200

function readNotificationFromEvent(event: AppEventPayload): NotificationDto | null {
  const payload = event.payload
  if (!payload || typeof payload !== 'object') return null
  const notification = (payload as { notification?: unknown }).notification
  if (!notification || typeof notification !== 'object') return null
  const candidate = notification as Partial<NotificationDto>
  if (typeof candidate.id !== 'string' || typeof candidate.type !== 'string') return null
  return candidate as NotificationDto
}

export function useNotificationEffect(
  notificationType: string | string[],
  effect: (notification: NotificationDto) => void,
  deps: React.DependencyList = [],
) {
  const seenIdsRef = React.useRef<string[]>([])

  const handleNotification = React.useCallback((notification: NotificationDto) => {
    if (!matchesType(notificationType, notification.type)) return
    if (seenIdsRef.current.includes(notification.id)) return
    seenIdsRef.current = [notification.id, ...seenIdsRef.current.filter((id) => id !== notification.id)]
      .slice(0, MAX_SEEN_IDS)
    effect(notification)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationType, ...deps])

  React.useEffect(() => {
    const unsubscribe = subscribeNotificationEffects(notificationType, handleNotification)
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationType, handleNotification])

  useAppEvent(
    NOTIFICATION_CREATED_EVENT,
    (event) => {
      const notification = readNotificationFromEvent(event)
      if (!notification) return
      handleNotification(notification)
    },
    [handleNotification],
  )
}
