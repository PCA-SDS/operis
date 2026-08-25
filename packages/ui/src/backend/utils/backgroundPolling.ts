"use client"
import * as React from 'react'

/**
 * Scheduling primitives shared by the backend chrome pollers (progress,
 * notifications, messages).
 *
 * They exist so every background refresher behaves the same way on the three
 * axes that used to be hand-rolled per hook and got at least one of them wrong:
 * a hidden tab stops issuing requests, a failing backend is backed off instead
 * of hammered at full rate, and restoring a tab issues one request rather than
 * one per listener.
 */

const DEFAULT_TAB_RESTORE_COALESCE_MS = 2000
const MAX_BACKOFF_EXPONENT = 16

/**
 * Bounded exponential backoff. `consecutiveFailures` of 0 returns the base
 * delay, so a healthy poller keeps its normal cadence.
 */
export function computeBackoffDelay(
  baseMs: number,
  consecutiveFailures: number,
  maxMs: number,
): number {
  if (consecutiveFailures <= 0) return baseMs
  const exponent = Math.min(consecutiveFailures, MAX_BACKOFF_EXPONENT)
  return Math.min(baseMs * 2 ** exponent, maxMs)
}

/**
 * Run `callback` every `intervalMs` while `enabled` is true and the tab is
 * visible. The timer is torn down whenever the document is hidden and restarted
 * on restore, so a backgrounded tab issues zero requests.
 *
 * This hook only owns the timer; pair it with `useTabRestoreRefresh` when the
 * poller should also refresh immediately on restore.
 */
export function useVisibilityAwareInterval(
  callback: () => void,
  intervalMs: number,
  enabled: boolean,
): void {
  const callbackRef = React.useRef(callback)
  React.useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  React.useEffect(() => {
    if (!enabled) return
    if (typeof document === 'undefined') return

    let timer: ReturnType<typeof setInterval> | null = null

    const stop = () => {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    }

    const start = () => {
      if (timer !== null) return
      timer = setInterval(() => {
        callbackRef.current()
      }, intervalMs)
    }

    const onVisibilityChange = () => {
      if (document.hidden) stop()
      else start()
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, intervalMs])
}

/**
 * Run `callback` once when the tab is restored.
 *
 * Deliberately listens to `visibilitychange` only. Restoring a tab fires both
 * `visibilitychange` and `window.focus`, so hooks that listened to both issued
 * every restore request twice. The `coalesceMs` guard additionally absorbs
 * visibility flapping (a restore that immediately re-hides and re-shows).
 */
export function useTabRestoreRefresh(
  callback: () => void,
  coalesceMs: number = DEFAULT_TAB_RESTORE_COALESCE_MS,
): void {
  const callbackRef = React.useRef(callback)
  React.useEffect(() => {
    callbackRef.current = callback
  }, [callback])
  const lastRestoreAtRef = React.useRef(0)

  React.useEffect(() => {
    if (typeof document === 'undefined') return

    const onVisibilityChange = () => {
      if (document.hidden) return
      const now = Date.now()
      if (now - lastRestoreAtRef.current < coalesceMs) return
      lastRestoreAtRef.current = now
      callbackRef.current()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [coalesceMs])
}
