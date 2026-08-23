"use client"

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

const FLASH_MS = 2200

export const NEW_TASK_PARAM = 'new'

/**
 * After Quick Add creates a task the user is often looking at a different list
 * than the one it landed in. The creator puts the new id in the URL; this hook
 * picks it up, scrolls the row into view, washes it for a couple of seconds and
 * then clears the marker so a refresh does not replay the highlight.
 */
export function useNewTaskFlash(): {
  flashTaskId: string | null
  flashRef: (node: HTMLElement | null) => void
} {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const marker = searchParams.get(NEW_TASK_PARAM)
  const [flashTaskId, setFlashTaskId] = React.useState<string | null>(null)
  const scrolledFor = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!marker) return
    setFlashTaskId(marker)
    const next = new URLSearchParams(searchParams.toString())
    next.delete(NEW_TASK_PARAM)
    const serialized = next.toString()
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false })
  }, [marker, pathname, router, searchParams])

  React.useEffect(() => {
    if (!flashTaskId) return
    const timer = window.setTimeout(() => setFlashTaskId(null), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flashTaskId])

  const flashRef = React.useCallback(
    (node: HTMLElement | null) => {
      if (!node || !flashTaskId || scrolledFor.current === flashTaskId) return
      scrolledFor.current = flashTaskId
      node.scrollIntoView({ block: 'nearest' })
    },
    [flashTaskId],
  )

  return { flashTaskId, flashRef }
}

/** The just-created wash. Rounded, so it reads as a chip on the row rather than
 *  a full-bleed band. */
export const FLASH_ROW_CLASS = 'rounded-lg bg-primary-soft'
