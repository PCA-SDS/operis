'use client'

import * as React from 'react'

/**
 * One clock for the whole appointments list.
 *
 * `AppointmentUrgencyCell` and `AppointmentArrivalInfo` each render once per
 * row, and each used to own a `setInterval`. The list API returns up to 100
 * rows and the page renders them all, so the screen carried up to 200
 * independent timers — each firing its own `setState` in a separate task, which
 * React cannot batch, producing ~200 separate re-renders a minute.
 *
 * A single module-level interval fanned out through `useSyncExternalStore`
 * gives every consumer the same tick, batched into one render. Mirrors the
 * pattern already used by `warranty_claims/backend/components/claimSla.tsx`.
 */
const CLOCK_INTERVAL_MS = 60_000

const listeners = new Set<() => void>()
let clockNow = Date.now()
let intervalId: ReturnType<typeof setInterval> | null = null

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!intervalId) {
    clockNow = Date.now()
    intervalId = setInterval(() => {
      clockNow = Date.now()
      for (const notify of listeners) notify()
    }, CLOCK_INTERVAL_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  }
}

function getSnapshot(): number {
  return clockNow
}

export function useNow(): number {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
