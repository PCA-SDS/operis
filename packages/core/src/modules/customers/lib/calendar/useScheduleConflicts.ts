"use client"

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

/**
 * Overlapping interactions for a slot that may not exist yet.
 *
 * Asks `/api/customers/interactions/conflicts`, which queries the database
 * rather than whatever the caller happens to have loaded. That distinction is
 * the whole point: a calendar holds one visible range, so a check against its
 * own items silently misses a clash the user cannot currently see, and a
 * "no conflicts" answer that only means "none on this screen" is worse than no
 * answer at all.
 *
 * Shared by the calendar's meeting quick-add and the detail page's Schedule
 * Activity dialog so there is one debounce, one query shape and one set of
 * failure semantics behind both, instead of each growing its own copy.
 *
 * Failures resolve to no conflicts. This is advisory: the server re-checks
 * nothing and the user may double-book deliberately, so a warning that cannot
 * be produced must not block a save that would otherwise succeed.
 */
export type ScheduleConflict = {
  id: string
  title: string | null
  startTime: string
  endTime: string
  type: string
}

type ConflictPayload = { hasConflicts?: boolean; conflicts?: ScheduleConflict[] }
type ConflictResponseBody = ConflictPayload & { result?: ConflictPayload }

const DEBOUNCE_MS = 500

export function useScheduleConflicts({
  enabled,
  date,
  startTime,
  durationMinutes,
  excludeId,
  types,
}: {
  /** Skip the check entirely — dialog closed, all-day, or fields incomplete. */
  enabled: boolean
  /** `YYYY-MM-DD`. */
  date: string | null
  /** `HH:MM`. */
  startTime: string | null
  durationMinutes: number | null
  /** The record being edited, so it does not clash with itself. */
  excludeId?: string | null
  /** Interaction types to count as a clash. Omitted means all of them. */
  types?: readonly string[]
}): { conflicts: ScheduleConflict[]; loading: boolean } {
  const [conflicts, setConflicts] = React.useState<ScheduleConflict[]>([])
  const [loading, setLoading] = React.useState(false)

  // Joined so a new array literal from the caller on every render does not
  // restart the debounce and leave the request permanently pending.
  const typesKey = types && types.length > 0 ? [...types].join(',') : ''

  React.useEffect(() => {
    if (!enabled || !date || !startTime || !durationMinutes || durationMinutes <= 0) {
      setConflicts([])
      setLoading(false)
      return
    }

    let cancelled = false
    const controller = new AbortController()
    setLoading(true)

    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          date,
          startTime,
          duration: String(durationMinutes),
        })
        if (excludeId) params.set('excludeId', excludeId)
        if (typesKey) params.set('types', typesKey)

        // The server builds the window from a wall-clock date and time, so it
        // needs the viewer's offset to land on the same instant they see.
        const localStart = new Date(`${date}T${startTime}:00`)
        if (!Number.isNaN(localStart.getTime())) {
          params.set('timezoneOffsetMinutes', String(-localStart.getTimezoneOffset()))
        }

        /* `readApiResultOrThrow` hands back the whole parsed body, not the
           `result` field inside it, so the payload lives one level down at
           `body.result`. Reading `body.hasConflicts` directly yields undefined
           and so silently reports "no conflicts" for every slot — which is how
           the Schedule Activity dialog's check had been failing. Both shapes
           are accepted so the hook keeps working either way. */
        const body = await readApiResultOrThrow<ConflictResponseBody>(
          `/api/customers/interactions/conflicts?${params.toString()}`,
          { signal: controller.signal },
        )
        if (cancelled) return
        const payload = body && 'result' in body && body.result ? body.result : body
        setConflicts(
          payload && payload.hasConflicts && Array.isArray(payload.conflicts)
            ? payload.conflicts
            : [],
        )
      } catch {
        if (!cancelled) setConflicts([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [enabled, date, startTime, durationMinutes, excludeId, typesKey])

  return { conflicts, loading }
}
