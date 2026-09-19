'use client'

import * as React from 'react'

const DEFAULT_DEBOUNCE_MS = 300

export function useDebouncedValue<T>(value: T, delayMs = DEFAULT_DEBOUNCE_MS): T {
  const [debouncedValue, setDebouncedValue] = React.useState(value)

  React.useEffect(() => {
    const delay = Math.max(0, delayMs)
    const handle = window.setTimeout(() => setDebouncedValue(value), delay)
    return () => window.clearTimeout(handle)
  }, [delayMs, value])

  return debouncedValue
}
