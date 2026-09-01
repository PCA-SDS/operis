"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'

import { calendarTimeZone, formatCalendarDate, mapTaskToCalendarItem } from '../../lib/calendar/taskItem'
import { calendarTaskPayloadSchema, type CalendarRange, type CalendarTaskItem } from './types'

/**
 * The Task Manager's tasks, projected onto the calendar.
 *
 * The Task Manager stays the source of truth: this reads its own windowed
 * `my-tasks/calendar` endpoint, which is tenant- and organization-scoped,
 * `tasks.view`-gated and capped server-side. Nothing about task scheduling,
 * permissions or filtering is re-implemented here — the calendar asks the same
 * question the tasks module's own calendar panel asks, over the same route.
 *
 * It is reached over HTTP rather than through the tasks module's React Query
 * hooks because a static cross-module import would make disabling tasks break
 * the CRM calendar; `tasks/__tests__/moduleGating.test.ts` enforces that. The
 * coupling instead runs through the two things modules are allowed to share:
 * the HTTP contract and the event bus.
 */

const TASKS_CALENDAR_PATH = '/api/tasks/my-tasks/calendar'

/** A local, not-yet-confirmed change to one task's placement. */
export type TaskPlacementOverride = { calendarDate: string; calendarTime: string | null }

export type UseCalendarTasksResult = {
  items: CalendarTaskItem[]
  isLoading: boolean
  error: string | null
  /** The window held more tasks than the server will return at once. */
  truncated: boolean
  refetch: () => void
  /** Show a drag immediately, before the server has confirmed it. */
  applyOverride(id: string, override: TaskPlacementOverride): void
  /** Drop a local change — used when the write fails. */
  clearOverride(id: string): void
}

const EMPTY: CalendarTaskItem[] = []

export function useCalendarTasks(range: CalendarRange, enabled: boolean): UseCalendarTasksResult {
  const [payloads, setPayloads] = React.useState<unknown[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [truncated, setTruncated] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [overrides, setOverrides] = React.useState<Record<string, TaskPlacementOverride>>({})

  const from = formatCalendarDate(range.from)
  // The calendar's range end is exclusive; the task API's `to` is inclusive, so
  // the boundary is stepped back rather than pulling in an extra day the grid
  // would only filter away again.
  const to = formatCalendarDate(new Date(range.to.getTime() - 1))

  React.useEffect(() => {
    if (!enabled) {
      setPayloads([])
      setTruncated(false)
      setError(null)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    setIsLoading(true)
    setError(null)
    const params = new URLSearchParams({ mode: 'scheduled', from, to, tz: calendarTimeZone() })
    apiCall<{ items?: unknown[]; truncated?: boolean }>(`${TASKS_CALENDAR_PATH}?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          // A caller without `tasks.view` simply has no task layer; that is a
          // permission outcome, not a calendar failure, so the grid still
          // renders its interactions.
          setPayloads([])
          setTruncated(false)
          if (call.status !== 403 && call.status !== 401) {
            setError(`[internal] tasks calendar fetch failed (${call.status})`)
          }
          return
        }
        setPayloads(Array.isArray(call.result?.items) ? call.result.items : [])
        setTruncated(call.result?.truncated === true)
      })
      .catch(() => {
        if (cancelled || controller.signal.aborted) return
        setPayloads([])
        setTruncated(false)
        setError('[internal] tasks calendar fetch failed')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [enabled, from, to, reloadToken])

  const refetch = React.useCallback(() => setReloadToken((token) => token + 1), [])

  const applyOverride = React.useCallback((id: string, override: TaskPlacementOverride) => {
    setOverrides((current) => ({ ...current, [id]: override }))
  }, [])

  const clearOverride = React.useCallback((id: string) => {
    setOverrides((current) => {
      if (!(id in current)) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }, [])

  // A landed response is the truth, so overrides retire with the payloads they
  // were anticipating rather than lingering on top of confirmed data.
  React.useEffect(() => {
    setOverrides((current) => (Object.keys(current).length === 0 ? current : {}))
  }, [payloads])

  // Every task write anywhere in the product — the board, a list, the API, an
  // automation — emits a `clientBroadcast` task event, so this is how a change
  // made outside the calendar reaches it without polling or a shared cache.
  useAppEvent(
    'tasks.*',
    () => {
      if (enabled) refetch()
    },
    [enabled, refetch],
  )

  const items = React.useMemo(() => {
    if (!enabled || payloads.length === 0) return EMPTY
    const mapped: CalendarTaskItem[] = []
    for (const payload of payloads) {
      const parsed = calendarTaskPayloadSchema.safeParse(payload)
      if (!parsed.success) continue
      // Overrides are folded in before mapping, so a dragged task flows through
      // exactly the same geometry as a persisted one.
      const override = overrides[parsed.data.id]
      const item = mapTaskToCalendarItem(override ? { ...parsed.data, ...override } : parsed.data)
      if (item) mapped.push(item)
    }
    return mapped
  }, [payloads, overrides, enabled])

  return {
    items,
    isLoading: enabled && isLoading,
    error,
    truncated,
    refetch,
    applyOverride,
    clearOverride,
  }
}
