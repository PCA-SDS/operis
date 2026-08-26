"use client"

import * as React from 'react'

const MINUTE_MS = 60_000

/**
 * One shared clock for the whole calendar.
 *
 * Reading `Date.now()` during render makes a component impure and never
 * refreshes; a timer per event block would mean hundreds of timers. This hook
 * owns a single interval, aligns it to the next minute boundary, and pauses
 * while the tab is hidden so a backgrounded calendar costs nothing.
 */
export function useNowTick(enabled: boolean = true): number {
  const [now, setNow] = React.useState<number>(() => Date.now())

  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    let intervalId: number | undefined
    let timeoutId: number | undefined

    const stop = () => {
      if (intervalId !== undefined) window.clearInterval(intervalId)
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      intervalId = undefined
      timeoutId = undefined
    }

    const start = () => {
      stop()
      setNow(Date.now())
      // Align to the next whole minute so the indicator moves when the clock does.
      const msToNextMinute = MINUTE_MS - (Date.now() % MINUTE_MS)
      timeoutId = window.setTimeout(() => {
        setNow(Date.now())
        intervalId = window.setInterval(() => setNow(Date.now()), MINUTE_MS)
      }, msToNextMinute)
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [enabled])

  return now
}
