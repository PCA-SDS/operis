"use client"

import * as React from 'react'

/**
 * One motion for every panel that enters from the side of the screen: the
 * `Drawer`, `Sheet` and side-anchored `Dialog` primitives, and the panels a
 * module draws itself (version history, columns, views, the AI dock).
 *
 * The panel slides the whole way in from its edge on `ease-panel`, Apple's
 * sheet curve (a quick start that settles slowly), in 500ms, and leaves the
 * same way in 300ms. The scrim behind it fades on the same timing. It was
 * four different motions: 200/150ms on the default curve for a Drawer,
 * 300/200ms for a Sheet, a rise-and-fade for the Dialog-based sheets, and
 * nothing at all for the hand-built panels, which appeared and vanished.
 *
 * Every class keys off `data-state`, which Radix sets on its overlays and
 * `useSidePanelPresence` sets on the rest, so a Radix sheet and a hand-built
 * panel move identically. The exit holds its last frame, so a panel that is
 * unmounted just after its animation never flashes back into place, and a
 * closing panel takes no clicks. Reduced motion collapses all of it to an
 * instant change (`globals.css`).
 */
const SIDE_PANEL_TIMING =
  'data-[state=open]:animate-in data-[state=closed]:animate-out ' +
  'data-[state=open]:duration-500 data-[state=closed]:duration-300 ' +
  'data-[state=closed]:fill-mode-forwards data-[state=closed]:pointer-events-none ease-panel'

export const SIDE_PANEL_MOTION = {
  right: `${SIDE_PANEL_TIMING} data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right`,
  left: `${SIDE_PANEL_TIMING} data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left`,
  top: `${SIDE_PANEL_TIMING} data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top`,
  bottom: `${SIDE_PANEL_TIMING} data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom`,
} as const

export type SidePanelSide = keyof typeof SIDE_PANEL_MOTION

/** The scrim behind a side panel: a fade on the panel's own timing. */
export const SIDE_PANEL_SCRIM_MOTION =
  `${SIDE_PANEL_TIMING} data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0`

/**
 * For a panel that stays mounted and is moved by classes (a mobile sidebar
 * that is `-translate-x-full` until opened): the same curve, 500ms towards
 * the open state and 300ms back. Use `open` / `closed` with the panel's own
 * transform classes.
 */
export const SIDE_PANEL_TRANSITION = {
  open: 'transition-transform duration-500 ease-panel',
  closed: 'transition-transform duration-300 ease-panel',
} as const

/** The same motion for a panel animated in script (framer-motion). */
export const SIDE_PANEL_EASE = [0.32, 0.72, 0, 1] as const
export const SIDE_PANEL_ENTER_SECONDS = 0.5
export const SIDE_PANEL_EXIT_SECONDS = 0.3
export const SIDE_PANEL_EXIT_MS = 300

export type SidePanelState = 'open' | 'closed'

/**
 * Keeps a hand-built panel mounted while it slides out.
 *
 * `present` stays true for the length of the exit after `open` turns false,
 * and `state` is what the panel sets as `data-state`, so the
 * `SIDE_PANEL_MOTION` classes play the entrance and the exit. Reopening
 * during the exit cancels the unmount and slides the panel straight back.
 */
export function useSidePanelPresence(open: boolean): { present: boolean; state: SidePanelState } {
  const [lingering, setLingering] = React.useState(false)
  const [wasOpen, setWasOpen] = React.useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    setLingering(!open)
  }
  React.useEffect(() => {
    if (!lingering) return
    const timer = window.setTimeout(() => setLingering(false), SIDE_PANEL_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [lingering])
  return { present: open || lingering, state: open ? 'open' : 'closed' }
}

/**
 * For a Radix sheet whose parent mounts it only while it is open. The sheet
 * keeps its own `open`, closes itself first, and tells the parent once the
 * slide out has played, so the parent's unmount never cuts the exit short.
 * Pass `open` to the Radix root and call `dismiss` wherever the panel closed
 * itself before; `dismissThen` closes it and runs another callback in place
 * of `onClose` (a "saved" handler that also unmounts the panel).
 */
export function useSidePanelDismiss(onClose: () => void): {
  open: boolean
  dismiss: () => void
  dismissThen: (after: () => void) => void
} {
  const [open, setOpen] = React.useState(true)
  const onCloseRef = React.useRef(onClose)
  const afterRef = React.useRef<(() => void) | null>(null)
  React.useEffect(() => {
    onCloseRef.current = onClose
  })
  React.useEffect(() => {
    if (open) return
    const timer = window.setTimeout(() => (afterRef.current ?? onCloseRef.current)(), SIDE_PANEL_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [open])
  const dismiss = React.useCallback(() => setOpen(false), [])
  const dismissThen = React.useCallback((after: () => void) => {
    afterRef.current = after
    setOpen(false)
  }, [])
  return { open, dismiss, dismissThen }
}
