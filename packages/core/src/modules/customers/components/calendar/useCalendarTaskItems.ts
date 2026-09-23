"use client"

import * as React from 'react'
import { z } from 'zod'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { CalendarItem, CalendarRange, CalendarTaskItem } from './types'

/**
 * Tasks that are due inside the visible calendar range.
 *
 * Deliberately thin. It asks `/api/tasks/my-tasks/calendar` — the endpoint the
 * tasks module already publishes for exactly this, guarded server-side by
 * `requireAuth` + `requireFeatures: ['tasks.view']` — and returns the few
 * fields the calendar draws. Scoping, tenancy and permissions are the server's
 * job; this hook never widens them and never sends an id it was not given.
 *
 * The response is parsed rather than cast. A `satisfies`/`as` would make the
 * types line up while leaving a malformed payload to explode further down in
 * rendering, so every item goes through zod and anything that fails is dropped
 * instead of taking the calendar with it.
 */

const calendarTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** `YYYY-MM-DD` in the requested timezone — the day the task belongs on. */
  calendarDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  calendarTime: z.string().nullish(),
  status: z.string(),
  projectId: z.string(),
  projectKey: z.string().nullish(),
})

const responseSchema = z.object({
  items: z.array(z.unknown()).optional(),
  truncated: z.boolean().optional(),
})

export type UseCalendarTaskItemsResult = {
  /** Ready to merge into the grid's item list — always all-day. */
  items: CalendarItem[]
  isLoading: boolean
  /** The window held more tasks than the endpoint returns at once. */
  truncated: boolean
  reload: () => void
}

const EMPTY: CalendarItem[] = []

/**
 * A task is a DEADLINE, not an interval: the record holds a due date and no
 * duration. Drawing it as a block on the clock would invent a length the task
 * does not have, so every task goes in the all-day lane at the top of its day —
 * the same place Google Calendar puts them.
 *
 * `end` is the NEXT midnight, not the same one. The all-day packer treats `end`
 * as exclusive: it rejects `end <= rangeStart` outright and then reads the day
 * from `end - 1ms`. A zero-length entry therefore fails both checks — it looks
 * like it ends before it starts — and is silently dropped, which is exactly how
 * a task with a correct `due_date` still failed to appear on the grid. Spanning
 * to the next midnight is the same convention `toAllDayRange` uses.
 */
function toAllDayTaskItem(raw: z.infer<typeof calendarTaskSchema>, dueOn: Date): CalendarTaskItem {
  const dayAfter = new Date(dueOn.getFullYear(), dueOn.getMonth(), dueOn.getDate() + 1)
  return {
    id: raw.id,
    source: 'task',
    title: raw.title,
    interactionType: 'task',
    category: 'task',
    status: raw.status === 'done' ? 'done' : raw.status === 'canceled' ? 'canceled' : 'planned',
    start: dueOn,
    end: dayAfter,
    allDay: true,
    location: null,
    platform: null,
    locationKind: null,
    participants: [],
    ownerUserId: null,
    entityId: null,
    dealId: null,
    color: null,
    isRecurringOccurrence: false,
    updatedAt: null,
    task: {
      id: raw.id,
      title: raw.title,
      status: raw.status,
      projectId: raw.projectId,
      projectKey: raw.projectKey ?? undefined,
      calendarDate: raw.calendarDate,
      calendarTime: raw.calendarTime ?? null,
    },
  }
}

function toLocalMidnight(isoDay: string): Date | null {
  const [year, month, day] = isoDay.split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

function toIsoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function useCalendarTaskItems(
  range: CalendarRange,
  enabled: boolean,
): UseCalendarTaskItemsResult {
  const [items, setItems] = React.useState<CalendarItem[]>(EMPTY)
  const [isLoading, setIsLoading] = React.useState(false)
  const [truncated, setTruncated] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)

  const from = toIsoDay(range.from)
  const to = toIsoDay(range.to)

  React.useEffect(() => {
    if (!enabled) {
      setItems(EMPTY)
      setTruncated(false)
      setIsLoading(false)
      return
    }

    // A range change while a request is in flight would otherwise let the older
    // response land last and paint the wrong week.
    let active = true
    setIsLoading(true)

    const params = new URLSearchParams({
      mode: 'scheduled',
      from,
      to,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    })

    apiCall<unknown>(`/api/tasks/my-tasks/calendar?${params.toString()}`, { method: 'GET' })
      .then((response) => {
        if (!active) return
        // `apiCall` resolves for non-2xx too; `result` is null unless the body
        // parsed. A failed load leaves the lane empty rather than throwing.
        const parsed = responseSchema.safeParse(response.result)
        if (!response.ok || !parsed.success) {
          setItems(EMPTY)
          setTruncated(false)
          return
        }
        const next: CalendarItem[] = []
        for (const raw of parsed.data.items ?? []) {
          const item = calendarTaskSchema.safeParse(raw)
          if (!item.success) continue
          const dueOn = toLocalMidnight(item.data.calendarDate)
          if (!dueOn) continue
          next.push(toAllDayTaskItem(item.data, dueOn))
        }
        setItems(next)
        setTruncated(parsed.data.truncated === true)
      })
      .catch(() => {
        // A failed task load must not blank the events beside them — the grid
        // keeps rendering and the task lane is simply empty.
        if (!active) return
        setItems(EMPTY)
        setTruncated(false)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [enabled, from, to, reloadToken])

  const reload = React.useCallback(() => setReloadToken((token) => token + 1), [])

  return { items, isLoading, truncated, reload }
}
