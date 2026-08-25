"use client"
import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import {
  computeBackoffDelay,
  useTabRestoreRefresh,
  useVisibilityAwareInterval,
} from '../utils/backgroundPolling'
import {
  subscribeNotificationNew,
  emitNotificationCountChanged,
} from '@open-mercato/shared/lib/frontend/notificationEvents'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import { useOptionalT } from '@open-mercato/shared/lib/i18n/context'
import { dispatchNotificationHandlers } from './NotificationDispatcher'
import { useNotificationActions } from './useNotificationActions'
import { useNotificationHandlerFeatures } from './useNotificationHandlerFeatures'

export type UseNotificationsPollResult = {
  notifications: NotificationDto[]
  unreadCount: number
  hasNew: boolean
  isLoading: boolean
  error: string | null
  refresh: () => void
  markAsRead: (id: string) => Promise<void>
  executeAction: (id: string, actionId: string) => Promise<{ href?: string }>
  dismiss: (id: string) => Promise<void>
  dismissUndo: { notification: NotificationDto; previousStatus: 'read' | 'unread' } | null
  undoDismiss: () => Promise<void>
  markAllRead: () => Promise<void>
}

const POLL_INTERVAL = 5000
const MAX_POLL_INTERVAL = 60000
// Floor for full-list reconciliation. The tick only reads the cheap unread-count
// endpoint; changes that leave the count untouched (a dismissal elsewhere, an
// edited body) would otherwise never land, so the list is refetched at least
// this often regardless.
const LIST_RECONCILE_INTERVAL = 60000
const MAX_BACKOFF_STEPS = 16
const NEW_NOTIFICATION_PULSE_MS = 3000

export function useNotificationsPoll(): UseNotificationsPollResult {
  const [notifications, setNotifications] = React.useState<NotificationDto[]>([])
  const [unreadCount, setUnreadCount] = React.useState(0)
  const [hasNew, setHasNew] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [consecutiveFailures, setConsecutiveFailures] = React.useState(0)
  const grantedFeaturesRef = useNotificationHandlerFeatures()
  const translate = useOptionalT()
  const translateRef = React.useRef(translate)
  React.useEffect(() => { translateRef.current = translate }, [translate])
  const lastIdRef = React.useRef<string | null>(null)
  const prevUnreadRef = React.useRef(0)
  const lastListFetchAtRef = React.useRef(0)
  const pulseTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshAllRef = React.useRef<() => void>(() => {})
  const {
    markAsRead,
    executeAction,
    dismiss,
    dismissUndo,
    undoDismiss,
    markAllRead,
    markAsReadRef,
    dismissRef,
  } = useNotificationActions(notifications, setNotifications, setUnreadCount)

  const pulseHasNew = React.useCallback(() => {
    setHasNew(true)
    if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current)
    pulseTimeoutRef.current = setTimeout(() => {
      setHasNew(false)
      pulseTimeoutRef.current = null
    }, NEW_NOTIFICATION_PULSE_MS)
  }, [])

  React.useEffect(() => () => {
    if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current)
  }, [])

  const fetchList = React.useCallback(async (): Promise<boolean> => {
    const notifResult = await apiCall<{ items: NotificationDto[] }>('/api/notifications?pageSize=50')
    lastListFetchAtRef.current = Date.now()
    if (!notifResult.ok || !notifResult.result) return false

    const newNotifications = notifResult.result.items

    if (lastIdRef.current && newNotifications.length > 0) {
      const firstId = newNotifications[0].id
      if (firstId !== lastIdRef.current) pulseHasNew()
    }

    if (newNotifications.length > 0) {
      lastIdRef.current = newNotifications[0].id
    }

    setNotifications(newNotifications)

    if (newNotifications.length > 0) {
      dispatchNotificationHandlers(newNotifications, {
        features: grantedFeaturesRef.current,
        t: translateRef.current,
        currentPath:
          typeof window === 'undefined'
            ? '/'
            : `${window.location.pathname}${window.location.search}`,
        refreshNotifications: () => {
          refreshAllRef.current()
        },
        navigate: (href) => {
          if (typeof window === 'undefined') return
          if (!href.startsWith('/')) return
          window.location.assign(href)
        },
        markAsRead: async (notificationId) => markAsReadRef.current(notificationId),
        dismiss: async (notificationId) => dismissRef.current(notificationId),
      })
    }
    return true
  }, [dismissRef, grantedFeaturesRef, markAsReadRef, pulseHasNew])

  const fetchUnreadCount = React.useCallback(async (): Promise<{ ok: boolean; changed: boolean }> => {
    const countResult = await apiCall<{ unreadCount: number }>('/api/notifications/unread-count')
    if (!countResult.ok || !countResult.result) return { ok: false, changed: false }
    const newCount = countResult.result.unreadCount
    if (newCount === prevUnreadRef.current) return { ok: true, changed: false }
    prevUnreadRef.current = newCount
    setUnreadCount(newCount)
    emitNotificationCountChanged(newCount)
    return { ok: true, changed: true }
  }, [])

  const runSync = React.useCallback(async (mode: 'full' | 'tick') => {
    let succeeded = false
    try {
      if (mode === 'full') {
        const [listOk, count] = await Promise.all([fetchList(), fetchUnreadCount()])
        succeeded = listOk && count.ok
      } else {
        const count = await fetchUnreadCount()
        const listIsStale = Date.now() - lastListFetchAtRef.current >= LIST_RECONCILE_INTERVAL
        const listOk = count.changed || listIsStale ? await fetchList() : true
        succeeded = count.ok && listOk
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch notifications')
    } finally {
      setIsLoading(false)
      setConsecutiveFailures((prev) => (succeeded ? 0 : Math.min(prev + 1, MAX_BACKOFF_STEPS)))
    }
  }, [fetchList, fetchUnreadCount])

  const refreshAll = React.useCallback(() => {
    void runSync('full')
  }, [runSync])

  React.useEffect(() => { refreshAllRef.current = refreshAll }, [refreshAll])

  React.useEffect(() => {
    refreshAll()
  }, [refreshAll])

  useVisibilityAwareInterval(
    () => { void runSync('tick') },
    computeBackoffDelay(POLL_INTERVAL, consecutiveFailures, MAX_POLL_INTERVAL),
    true,
  )

  useTabRestoreRefresh(refreshAll)

  React.useEffect(() => {
    const unsub = subscribeNotificationNew(() => refreshAll())
    return unsub
  }, [refreshAll])

  return {
    notifications,
    unreadCount,
    hasNew,
    isLoading,
    error,
    refresh: refreshAll,
    markAsRead,
    executeAction,
    dismiss,
    dismissUndo,
    undoDismiss,
    markAllRead,
  }
}
