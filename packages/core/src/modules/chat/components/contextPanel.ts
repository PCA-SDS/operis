"use client"

import * as React from 'react'
import {
  readJsonFromLocalStorage,
  writeJsonToLocalStorage,
} from '@open-mercato/shared/lib/browser/safeLocalStorage'

/**
 * The conversation's contextual right-hand region.
 *
 * One region, one thing in it at a time. Pins and shared resources answer the
 * same question — "where did that go?" — and stacking them as two narrow
 * columns beside the transcript would leave three panes that are each too small
 * to use. Opening one while the other is showing swaps the contents and keeps
 * the width, so the region reads as a single place rather than a pile of
 * drawers.
 */

export type ChatContextPanelKind = 'pins' | 'shared'

/**
 * Widths, in pixels, in one place.
 *
 * The two minimums are the whole constraint system: the transcript has a width
 * below which the composer and message rows stop working, and the panel has one
 * below which a filename and a timestamp cannot sit on the same row. When the
 * container cannot afford both, there is no split to be had and the region
 * becomes an overlay instead of squeezing each side into something unusable.
 */
export const CHAT_PANEL_WIDTH = {
  /** Room for a name, a preview line and the unpin control without wrapping. */
  min: 280,
  /**
   * Wide enough to be useful, narrow enough that the transcript still holds a
   * comfortable measure on a laptop.
   */
  default: 340,
  /**
   * A cap in absolute terms, so a 34" monitor does not turn a list of pins into
   * a second document. `maxFraction` caps it again on smaller containers.
   */
  max: 520,
  /** Never more than this share of the container, whatever `max` says. */
  maxFraction: 0.45,
  /** Below this the transcript is not a transcript any more. */
  minChat: 440,
  /** The splitter's own width, counted when deciding whether a split fits. */
  handle: 9,
} as const

/**
 * One preference for the region, not one per conversation.
 *
 * Width is a statement about this reader's screen and how they like to work,
 * not about a particular conversation, and storing it per conversation would
 * grow without bound and feel arbitrary when a new one opened at a different
 * size.
 */
const WIDTH_STORAGE_KEY = 'om:chat:context-panel-width'

/** The smallest container that can hold a usable transcript and a usable panel. */
export function minimumSplitWidth(): number {
  return CHAT_PANEL_WIDTH.minChat + CHAT_PANEL_WIDTH.min + CHAT_PANEL_WIDTH.handle
}

/**
 * The widest the panel may be in a container of this size.
 *
 * Never so wide that the transcript drops below its minimum — which is what
 * makes dragging feel bounded rather than breaking the layout at the end of the
 * travel.
 */
export function maxPanelWidthFor(containerWidth: number): number {
  const leftForChat = containerWidth - CHAT_PANEL_WIDTH.minChat - CHAT_PANEL_WIDTH.handle
  return Math.min(
    CHAT_PANEL_WIDTH.max,
    Math.floor(containerWidth * CHAT_PANEL_WIDTH.maxFraction),
    leftForChat,
  )
}

/**
 * Fit a width to a container.
 *
 * Used on restore as well as on drag: a width saved on a wide monitor is not a
 * width, it is a wish, and honouring it literally on a laptop is how a stored
 * preference turns into a horizontal scrollbar (§9).
 */
export function clampPanelWidth(width: number, containerWidth: number): number {
  const max = maxPanelWidthFor(containerWidth)
  if (max < CHAT_PANEL_WIDTH.min) return CHAT_PANEL_WIDTH.min
  return Math.round(Math.min(Math.max(width, CHAT_PANEL_WIDTH.min), max))
}

function readStoredWidth(): number {
  const stored = readJsonFromLocalStorage<number>(WIDTH_STORAGE_KEY, CHAT_PANEL_WIDTH.default)
  // A hand-edited or corrupted entry is a number that is not one.
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return CHAT_PANEL_WIDTH.default
  return stored
}

export type ChatContextPanelState = {
  kind: ChatContextPanelKind | null
  /** The stored preference, before it is fitted to the current container. */
  width: number
  open: (kind: ChatContextPanelKind) => void
  close: () => void
  toggle: (kind: ChatContextPanelKind) => void
  setWidth: (width: number) => void
  resetWidth: () => void
}

/**
 * Which tool is showing, and how wide the region is.
 *
 * The width is read after mount rather than during render: the server has no
 * `localStorage`, so seeding state from it directly renders one width on the
 * server and another on the client, which React reports as a hydration
 * mismatch. Every other persisted preference in this codebase reads it the same
 * way.
 */
/**
 * Which tool is showing, held outside React.
 *
 * Measured, not assumed: the App Router remounts the whole chat shell when the
 * conversation id in the path changes, so state held in a component — at any
 * depth, including above `ConversationView`'s key — is destroyed by a switch.
 * The panel closed every time the reader moved between conversations, which is
 * the one thing §18 says it must not do.
 *
 * A module binding survives that remount because the module is not re-evaluated,
 * and it is reset by a full page load because then it is. That is exactly the
 * lifetime wanted: the region follows you around the chat module, and a fresh
 * visit starts closed.
 *
 * Never written on the server — `setKind` only ever runs from an event handler —
 * so this cannot carry one request's state into another's HTML, and the first
 * client render after a load reads the same `null` the server rendered.
 */
let openKind: ChatContextPanelKind | null = null

export function useChatContextPanel(): ChatContextPanelState {
  const [kind, setKindState] = React.useState<ChatContextPanelKind | null>(() =>
    typeof window === 'undefined' ? null : openKind,
  )
  const setKind = React.useCallback(
    (next: React.SetStateAction<ChatContextPanelKind | null>) => {
      setKindState((current) => {
        const resolved = typeof next === 'function' ? next(current) : next
        openKind = resolved
        return resolved
      })
    },
    [],
  )
  const [width, setWidthState] = React.useState<number>(CHAT_PANEL_WIDTH.default)
  const hydrated = React.useRef(false)

  React.useEffect(() => {
    setWidthState(readStoredWidth())
    hydrated.current = true
  }, [])

  const setWidth = React.useCallback((next: number) => {
    setWidthState(next)
    // Only once the stored value has been read, so the default does not
    // overwrite a real preference during the first commit.
    if (hydrated.current) writeJsonToLocalStorage(WIDTH_STORAGE_KEY, next)
  }, [])

  const resetWidth = React.useCallback(() => {
    setWidth(CHAT_PANEL_WIDTH.default)
  }, [setWidth])

  const open = React.useCallback((next: ChatContextPanelKind) => setKind(next), [])
  const close = React.useCallback(() => setKind(null), [])
  const toggle = React.useCallback(
    (next: ChatContextPanelKind) => setKind((current) => (current === next ? null : next)),
    [],
  )

  return { kind, width, open, close, toggle, setWidth, resetWidth }
}

/**
 * How much room the region actually has.
 *
 * Measured from the element rather than from the viewport (§11). The transcript
 * shares a row with a conversation rail that appears at `lg`, the browser can
 * be zoomed, and the window is not the container — a viewport query gets all
 * three wrong, and the question being asked is only ever "does a split fit in
 * *this* box".
 */
/**
 * Measure before the browser paints, not after.
 *
 * The width decides whether the region is a column or an overlay, so measuring
 * in a plain effect means the first painted frame is decided by a width of
 * zero — the panel appears as a drawer and then swaps to a split one frame
 * later. That flash is visible on every conversation switch, because the region
 * now survives one (§13).
 *
 * `useLayoutEffect` warns when React renders on the server, so the server takes
 * the deferred one; it never measures anything there in any case.
 */
const useMeasureEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

export function useContainerWidth<T extends HTMLElement>(): [
  (node: T | null) => void,
  number,
] {
  /**
   * A callback ref, not a `useRef`.
   *
   * The component measuring itself returns a different tree while its data is
   * loading or after it fails, and neither of those carries this ref. With a
   * plain ref the observer effect runs once, on the loading tree, finds
   * `current` still null and gives up — so the element it was meant to watch is
   * never observed and the layout stays stuck in its fallback mode for the life
   * of the mount. A callback ref fires when the node actually appears.
   */
  const [node, setNode] = React.useState<T | null>(null)
  const ref = React.useCallback((next: T | null) => setNode(next), [])
  const [containerWidth, setContainerWidth] = React.useState(0)

  useMeasureEffect(() => {
    if (!node) return

    const update = (next: number) => {
      // Sub-pixel churn from zoom or a scrollbar should not re-render the
      // transcript on every frame.
      setContainerWidth((prev) => (Math.abs(prev - next) < 1 ? prev : next))
    }

    update(node.getBoundingClientRect().width)

    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => update(node.getBoundingClientRect().width)
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) update(entry.contentRect.width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])

  return [ref, containerWidth]
}
