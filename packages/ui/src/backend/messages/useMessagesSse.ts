"use client"

import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import { useAppEvent } from '../injection/useAppEvent'
import { useTabRestoreRefresh } from '../utils/backgroundPolling'
import type { MessagePollItem, UseMessagesPollResult } from './useMessagesPoll'

export function useMessagesSse(): UseMessagesPollResult {
  const requestInit = React.useMemo(
    () => ({
      headers: {
        'x-om-forbidden-redirect': '0',
      },
    }),
    [],
  )
  const [messages, setMessages] = React.useState<MessagePollItem[]>([])
  const [unreadCount, setUnreadCount] = React.useState(0)
  const [hasNew, setHasNew] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const lastMessageIdRef = React.useRef<string | null>(null)
  const pulseTimeoutRef = React.useRef<number | null>(null)

  const fetchMessages = React.useCallback(async () => {
    try {
      // `pageSize=1`. The only consumer of this hook is `MessagesIcon`, which reads
      // `unreadCount` and `hasNew` — never the list. `hasNew` is derived purely from
      // whether the newest message id changed, so one row answers it exactly as
      // twenty did. The wildcard SSE subscription cannot replace this check:
      // `messages.message.*` also covers read/archived/deleted, which must not pulse
      // the badge. Fetching twenty also wrote twenty `access_logs` rows per refresh
      // (the CRUD factory logs one per returned record).
      const [listResult, countResult] = await Promise.all([
        apiCall<{ items?: MessagePollItem[] }>('/api/messages?folder=inbox&page=1&pageSize=1', requestInit),
        apiCall<{ unreadCount?: number }>('/api/messages/unread-count', requestInit),
      ])

      if (listResult.ok) {
        const nextMessages = Array.isArray(listResult.result?.items) ? listResult.result?.items ?? [] : []
        const firstId = nextMessages[0]?.id ?? null

        if (lastMessageIdRef.current && firstId && firstId !== lastMessageIdRef.current) {
          setHasNew(true)
          if (pulseTimeoutRef.current) {
            window.clearTimeout(pulseTimeoutRef.current)
          }
          pulseTimeoutRef.current = window.setTimeout(() => {
            setHasNew(false)
            pulseTimeoutRef.current = null
          }, 3000)
        }

        lastMessageIdRef.current = firstId
        setMessages(nextMessages)
      }

      if (countResult.ok) {
        const nextCount = Number(countResult.result?.unreadCount ?? 0)
        setUnreadCount(Number.isFinite(nextCount) ? Math.max(0, nextCount) : 0)
      }

      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load messages'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [requestInit])

  React.useEffect(() => {
    void fetchMessages()
  }, [fetchMessages])

  // `visibilitychange`-only + coalesced — see useTabRestoreRefresh. A raw
  // `focus` listener double-fired on every tab restore.
  useTabRestoreRefresh(React.useCallback(() => {
    void fetchMessages()
  }, [fetchMessages]))

  React.useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current) {
        window.clearTimeout(pulseTimeoutRef.current)
      }
    }
  }, [])

  useAppEvent(
    'messages.message.*',
    () => {
      void fetchMessages()
    },
    [fetchMessages],
  )

  useAppEvent(
    'om:bridge:reconnected',
    () => {
      void fetchMessages()
    },
    [fetchMessages],
  )

  return {
    messages,
    unreadCount,
    hasNew,
    isLoading,
    error,
    refresh: fetchMessages,
  }
}
