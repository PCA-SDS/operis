"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

type LaneResizeHandleProps = {
  /** Called with the cumulative delta (px) as the user drags. */
  onResize: (deltaPx: number) => void
  /** Called once when the drag ends. */
  onResizeEnd?: () => void
  /** Called on double-click — convention is "reset this lane to default width". */
  onReset?: () => void
}

/**
 * Thin vertical drag handle that sits on the right edge of a kanban lane.
 *
 * UX (matches Monday / Asana / ClickUp):
 * - Hover: 4 px column highlights, cursor flips to `col-resize`
 * - Drag: lane width updates live via `onResize`
 * - Double-click: emits `onReset` (the lane resets to its default width)
 *
 * The pointer listeners attach to `window` during the drag so the handle keeps tracking
 * even when the cursor moves off the handle's narrow hit area.
 *
 * Pointer moves are accumulated and flushed once per animation frame (same shape as
 * `ColumnResizeHandle` in `@open-mercato/ui/backend/DataTable`): a high-polling mouse
 * fires `pointermove` far faster than the display refreshes, and every un-coalesced
 * `onResize` commits React state on the 3000-line pipeline page. Deltas are summed
 * between frames and the residual is flushed on pointerup, so the cumulative delta the
 * page receives — and therefore the final lane width — is unchanged.
 */
export function LaneResizeHandle({ onResize, onResizeEnd, onReset }: LaneResizeHandleProps): React.ReactElement {
  const t = useT()
  const dragStateRef = React.useRef<{ lastX: number } | null>(null)
  const [isActive, setIsActive] = React.useState(false)
  // Holds the current drag's teardown so an unmount mid-drag (lane removal, pipeline
  // switch, data reload) still removes the window listeners, cancels the pending frame
  // and restores the body cursor/selection instead of leaking them.
  const dragCleanupRef = React.useRef<(() => void) | null>(null)
  React.useEffect(() => () => { dragCleanupRef.current?.() }, [])

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent) => {
      // Only respond to primary (left) mouse button / touch / pen
      if (event.button !== 0 && event.pointerType === 'mouse') return
      event.preventDefault()
      event.stopPropagation()
      setIsActive(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      dragStateRef.current = { lastX: event.clientX }

      let frame = 0
      let pendingDelta = 0
      const flush = () => {
        frame = 0
        const delta = pendingDelta
        pendingDelta = 0
        if (delta !== 0) onResize(delta)
      }
      const onMove = (moveEvent: PointerEvent) => {
        if (!dragStateRef.current) return
        const delta = moveEvent.clientX - dragStateRef.current.lastX
        if (delta === 0) return
        dragStateRef.current.lastX = moveEvent.clientX
        pendingDelta += delta
        if (frame) return
        frame = window.requestAnimationFrame(flush)
      }
      const teardown = () => {
        if (frame) {
          window.cancelAnimationFrame(frame)
          frame = 0
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        dragStateRef.current = null
        dragCleanupRef.current = null
      }
      const onUp = () => {
        teardown()
        // Commit whatever the last frame did not get to, so the released width is exact.
        flush()
        setIsActive(false)
        onResizeEnd?.()
      }

      dragCleanupRef.current = teardown
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [onResize, onResizeEnd],
  )

  const handleDoubleClick = React.useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      onReset?.()
    },
    [onReset],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={translateWithFallback(
        t,
        'customers.deals.kanban.lane.resizeHandle',
        'Drag to resize column. Double-click to reset width.',
      )}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      title={translateWithFallback(
        t,
        'customers.deals.kanban.lane.resizeHandle',
        'Drag to resize · double-click to reset',
      )}
      className={`absolute -right-0.5 top-0 z-20 h-full w-1.5 cursor-col-resize touch-none select-none ${
        isActive ? 'bg-accent-strong/40' : 'bg-transparent hover:bg-accent-strong/20'
      }`}
    />
  )
}

export default LaneResizeHandle
