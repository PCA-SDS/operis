"use client"
import * as React from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '../primitives/icon-button'
import { Button } from '../primitives/button'
import { Spinner } from '../primitives/spinner'

export type RowActionItem = {
  id?: string
  label: string
  /**
   * Returning a promise lets `RowActions` hold the entry disabled with a
   * spinner until the write settles, so re-opening the menu mid-flight cannot
   * fire the same (usually destructive) action twice.
   */
  /**
   * Declared `() => void` on purpose. TypeScript's void-return assignability
   * lets callers return anything — including `async () => {...}` and existing
   * sites that return `window.open(...)` — whereas a `void | Promise<void>`
   * union loses that exemption and breaks them. `runSelect` duck-types the
   * result at runtime, so returning a promise still drives the pending state.
   */
  onSelect?: () => void
  href?: string
  destructive?: boolean
  /** Renders the entry inert — clicks do nothing and navigation is blocked. */
  disabled?: boolean
  /** Caller-driven in-flight state; implies `disabled` and shows a spinner. */
  loading?: boolean
}

function itemKey(item: RowActionItem, index: number): string {
  return item.id ? `id:${item.id}` : `idx:${index}`
}

function isSameRect(a: DOMRect, b: DOMRect): boolean {
  return a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right
}

export function RowActions({ items = [] }: { items?: RowActionItem[] }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const hoverTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null)
  const [direction, setDirection] = React.useState<'down' | 'up'>('down')
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)

  const updatePosition = React.useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    // Scrolling produces a fresh DOMRect per event even when the anchor has not
    // moved; keeping the previous object lets React bail out of the re-render.
    setAnchorRect((prev) => (prev && isSameRect(prev, rect) ? prev : rect))
    // Decide whether to open up or down based on available viewport space
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    setDirection(spaceBelow < 180 && spaceAbove > spaceBelow ? 'up' : 'down')
  }, [])

  React.useEffect(() => {
    if (!open) return
    updatePosition()
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node
      if (menuRef.current && !menuRef.current.contains(t) && btnRef.current && !btnRef.current.contains(t)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    // Capture-phase scroll fires for every scrolling ancestor, faster than the
    // browser paints; coalesce into one measurement per animation frame.
    let frame = 0
    function onScrollOrResize() {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        updatePosition()
      })
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open, updatePosition])

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
    }
  }, [])

  const runSelect = React.useCallback((item: RowActionItem, key: string) => {
    const result = item.onSelect?.() as unknown
    if (!result || typeof (result as PromiseLike<unknown>).then !== 'function') return
    setPendingKey(key)
    void Promise.resolve(result).then(
      () => { setPendingKey((current) => (current === key ? null : current)) },
      () => { setPendingKey((current) => (current === key ? null : current)) },
    )
  }, [])

  if (items.length === 0) return null

  const handlePointerEnter = (event: React.PointerEvent) => {
    if (event.pointerType === 'touch') return
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
    }
    setOpen(true)
  }

  const handlePointerLeave = (event: React.PointerEvent) => {
    if (event.pointerType === 'touch') return
    hoverTimeoutRef.current = setTimeout(() => {
      setOpen(false)
    }, 150)
  }

  return (
    <div
      className="relative inline-block text-left"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <IconButton
        ref={btnRef}
        type="button"
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(true); requestAnimationFrame(updatePosition) }}
      >
        <span aria-hidden="true">⋯</span>
        <span className="sr-only">{t('ui.rowActions.openActions', 'Open actions')}</span>
      </IconButton>
      {open && anchorRect && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed flex w-44 max-w-[calc(100vw-1rem)] flex-col gap-1 rounded-md border bg-surface p-1 shadow focus-visible:outline-none z-dropdown"
          style={{
            top: direction === 'down' ? anchorRect.bottom + 8 : anchorRect.top - 8,
            left: Math.min(anchorRect.right, window.innerWidth - 8),
            transform: `translate(-100%, ${direction === 'down' ? '0' : '-100%'})`,
          }}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
        >
          {items.map((it, idx) => {
            const key = itemKey(it, idx)
            const isLoading = it.loading === true || pendingKey === key
            const isDisabled = it.disabled === true || isLoading
            return it.href ? (
              <a
                key={idx}
                href={it.href}
                className={`block w-full text-left px-2 py-1 text-sm rounded-md hover:bg-accent ${it.destructive ? 'text-destructive' : ''} ${isDisabled ? 'pointer-events-none opacity-60' : ''}`}
                role="menuitem"
                aria-disabled={isDisabled ? true : undefined}
                tabIndex={isDisabled ? -1 : undefined}
                onClick={(event) => {
                  event.stopPropagation()
                  if (isDisabled) {
                    event.preventDefault()
                    return
                  }
                  setOpen(false)
                }}
              >
                {it.label}
              </a>
            ) : (
              <Button
                key={idx}
                type="button"
                variant="ghost"
                size="sm"
                className={`w-full justify-start font-normal ${it.destructive ? 'text-destructive' : ''}`}
                role="menuitem"
                disabled={isDisabled}
                aria-busy={isLoading ? true : undefined}
                onClick={(event) => {
                  event.stopPropagation()
                  setOpen(false)
                  runSelect(it, key)
                }}
              >
                {isLoading ? (
                  <span aria-hidden="true" className="inline-flex">
                    <Spinner size="sm" />
                  </span>
                ) : null}
                {it.label}
              </Button>
            )
          })}
        </div>,
        document.body
      )}
    </div>
  )
}
