"use client"

import * as React from 'react'
import { useIsomorphicLayoutEffect } from '@open-mercato/ui/hooks/useIsomorphicLayoutEffect'

/**
 * The height left between an element's top and the bottom of the viewport.
 *
 * A calendar has to end where the window ends — its grid scrolls internally, the
 * page does not — and that needs a definite height. The design system's `fill`
 * model supplies one only when every ancestor passes a height down, and the
 * backend shell's `<main>` does not: it is `flex-1` with banners as siblings, so
 * `h-full` on the page resolves to `auto` and a 24-hour grid grows to its full
 * 1152px and pushes the page into a scroll instead of scrolling itself.
 *
 * Measuring sidesteps that without touching chrome shared by every backend page.
 * It converges rather than oscillating: once the element is clamped the page
 * stops scrolling, so its top stops moving.
 */
export function useAvailableHeight(
  ref: React.RefObject<HTMLElement | null>,
  minimumPx: number,
): number | null {
  const [height, setHeight] = React.useState<number | null>(null)

  useIsomorphicLayoutEffect(() => {
    const node = ref.current
    if (!node || typeof window === 'undefined') return

    const measure = () => {
      const top = node.getBoundingClientRect().top
      const available = window.innerHeight - top - VIEWPORT_BOTTOM_GUTTER_PX
      setHeight((current) => {
        const next = Math.max(minimumPx, Math.round(available))
        // Ignore sub-pixel churn, which would otherwise re-render on every
        // scroll frame while the layout settles.
        return current !== null && Math.abs(current - next) < 2 ? current : next
      })
    }

    measure()
    window.addEventListener('resize', measure)
    // The element's top moves when chrome above it wraps to another line, which
    // a window resize alone does not report.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(document.documentElement)
    if (node.parentElement) observer?.observe(node.parentElement)

    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [ref, minimumPx])

  return height
}

/** Breathing room under the calendar so it does not sit flush on the fold. */
const VIEWPORT_BOTTOM_GUTTER_PX = 16
