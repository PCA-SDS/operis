'use client'

import * as React from 'react'
import { createContext, useContext } from 'react'

import { cn } from '@open-mercato/shared/lib/utils'
import { SIDE_PANEL_EASE, SIDE_PANEL_EXIT_MS } from './side-panel-motion'

/**
 * Tab strip primitive. Every tab strip in the product looks and moves the
 * same way: text tabs in one weight, the selected one in full ink over a
 * hairline rail, and a 2px accent bar that glides from the old tab to the new
 * one on Apple's curve (`ease-panel`). A panel that swaps in fades in. Reduced
 * motion makes both instant.
 *
 * Each tab draws its own bar and the selected one shows it, so the bar is in
 * place on the first paint, in a strip that scrolls or wraps, and without
 * script. Script only animates a change: the new tab's bar starts where the
 * old one is on screen, mid-glide included, and settles into place.
 */

const INDICATOR_GLIDE: KeyframeAnimationOptions = {
  duration: SIDE_PANEL_EXIT_MS,
  easing: `cubic-bezier(${SIDE_PANEL_EASE.join(', ')})`,
}

/** The `fadeIn` motion from `globals.css`: content that swaps in place. */
const PANEL_FADE: KeyframeAnimationOptions = { duration: 150, easing: 'ease-out' }

const runningAnimations = new WeakMap<Element, Animation>()

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function stopAnimation(node: Element | null | undefined) {
  if (!node) return
  runningAnimations.get(node)?.cancel()
  runningAnimations.delete(node)
}

function playAnimation(node: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  if (typeof node.animate !== 'function' || prefersReducedMotion()) return
  stopAnimation(node)
  runningAnimations.set(node, node.animate(keyframes, options))
}

type IndicatorBox = { left: number; top: number; width: number; height: number }

function listOf(node: Element): Element | null {
  return node.closest('[data-slot="tabs-list"]')
}

function boxWithinList(node: HTMLElement, box: IndicatorBox): IndicatorBox | null {
  const frame = listOf(node)?.getBoundingClientRect()
  if (!frame) return null
  return { left: box.left - frame.left, top: box.top - frame.top, width: box.width, height: box.height }
}

/**
 * Plays the new tab's bar from where the old one is on screen to its own
 * place, and returns that place. The old bar is measured before its own glide
 * is stopped, so a change mid-glide starts from where the bar actually is.
 * When the old tab has left the strip, the bar starts from where it last came
 * to rest.
 */
function glideIndicator(from: HTMLElement | undefined, to: HTMLElement, lastShown: IndicatorBox | null): IndicatorBox {
  let first: IndicatorBox | null = null
  if (from) {
    first = from.getBoundingClientRect()
  } else if (lastShown) {
    const frame = listOf(to)?.getBoundingClientRect()
    if (frame) first = { ...lastShown, left: frame.left + lastShown.left, top: frame.top + lastShown.top }
  }
  stopAnimation(from)
  stopAnimation(to)
  const last = to.getBoundingClientRect()
  if (!first || !first.width || !first.height || !last.width || !last.height) return last
  const dx = first.left - last.left
  const dy = first.top - last.top
  const sx = first.width / last.width
  const sy = first.height / last.height
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) return last
  playAnimation(
    to,
    [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: 'none' }],
    INDICATOR_GLIDE,
  )
  return last
}

function fadeInPanel(node: HTMLElement | null) {
  if (!node) return
  playAnimation(node, [{ opacity: 0 }, { opacity: 1 }], PANEL_FADE)
}

type TabsContextValue = {
  value: string
  onValueChange: (value: string) => void
  orientation: 'horizontal' | 'vertical'
  registerIndicator: (value: string, node: HTMLElement) => () => void
  /** The value whose tab and panel are on screen. It trails `value` until the
   * commit that shows a new selection has run its layout effects. */
  shownValueRef: React.MutableRefObject<string>
}

export const TabsContext = createContext<TabsContextValue | undefined>(undefined)

export function useTabsContext() {
  const context = useContext(TabsContext)
  if (!context) {
    throw new Error('Tabs components must be used within a Tabs provider')
  }
  return context
}

/** @deprecated Tabs have one look. The prop is ignored and can be dropped. */
export type TabsVariant = 'underline'
export type TabsOrientation = 'horizontal' | 'vertical'

export type TabsProps = {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** @deprecated Tabs have one look. The prop is ignored and can be dropped. */
  variant?: TabsVariant
  /** Tab strip orientation. `horizontal` lays the tabs in a row over a
   * hairline rail; `vertical` stacks them, the selected one on a quiet fill. */
  orientation?: TabsOrientation
  children: React.ReactNode
  className?: string
}

export function Tabs({
  value: controlledValue,
  defaultValue,
  onValueChange,
  orientation = 'horizontal',
  children,
  className,
}: TabsProps) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue ?? '')
  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : uncontrolledValue

  const handleValueChange = React.useCallback(
    (newValue: string) => {
      if (!isControlled) {
        setUncontrolledValue(newValue)
      }
      onValueChange?.(newValue)
    },
    [isControlled, onValueChange],
  )

  const indicators = React.useRef(new Map<string, HTMLElement>())
  const shownValueRef = React.useRef(value)
  const lastShownBox = React.useRef<IndicatorBox | null>(null)

  const registerIndicator = React.useCallback((tabValue: string, node: HTMLElement) => {
    indicators.current.set(tabValue, node)
    return () => {
      if (indicators.current.get(tabValue) === node) indicators.current.delete(tabValue)
    }
  }, [])

  React.useLayoutEffect(() => {
    const previous = shownValueRef.current
    shownValueRef.current = value
    const next = indicators.current.get(value)
    if (!next) return
    const from = previous !== value ? indicators.current.get(previous) : undefined
    const resting = previous !== value
      ? glideIndicator(from?.isConnected ? from : undefined, next, lastShownBox.current)
      : next.getBoundingClientRect()
    lastShownBox.current = boxWithinList(next, resting)
  }, [value])

  const contextValue = React.useMemo<TabsContextValue>(
    () => ({ value, onValueChange: handleValueChange, orientation, registerIndicator, shownValueRef }),
    [value, handleValueChange, orientation, registerIndicator],
  )

  return (
    <TabsContext.Provider value={contextValue}>
      <div
        data-slot="tabs"
        data-orientation={orientation}
        className={cn(orientation === 'vertical' ? 'flex gap-4' : '', className)}
      >
        {children}
      </div>
    </TabsContext.Provider>
  )
}

export type TabsListProps = {
  children: React.ReactNode
  className?: string
  /** Accessible name for the `role="tablist"` element. Set it when the
   * surrounding context does not already label the strip (e.g. a bare
   * detail-page section switcher). */
  'aria-label'?: string
}

/**
 * A strip that runs out of room wraps onto a second row. To scroll it
 * sideways instead, put the scroll on a wrapper and give the list
 * `w-max min-w-full`: the rail then runs under every tab, and the selected
 * tab's bar, which sits on the rail, is not cut by the scroll edge.
 */
export function TabsList({ children, className, 'aria-label': ariaLabel }: TabsListProps) {
  const { orientation } = useTabsContext()
  const vertical = orientation === 'vertical'

  // Arrow keys move focus along the strip (Home and End to its ends); Enter or
  // Space selects, so a tab whose panel loads data is not fetched in passing.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const previousKey = vertical ? 'ArrowUp' : 'ArrowLeft'
    const nextKey = vertical ? 'ArrowDown' : 'ArrowRight'
    if (![previousKey, nextKey, 'Home', 'End'].includes(event.key)) return
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]:not(:disabled)'),
    )
    const current = tabs.findIndex((tab) => tab === event.target)
    if (current === -1) return
    event.preventDefault()
    const target =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (current + (event.key === nextKey ? 1 : -1) + tabs.length) % tabs.length
    tabs[target]?.focus()
  }

  return (
    <div
      data-slot="tabs-list"
      className={cn(
        vertical
          ? 'flex flex-col items-stretch gap-1'
          : 'flex min-h-10 w-full flex-wrap items-end gap-4 border-b border-border',
        className,
      )}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  )
}

export type TabsTriggerProps = {
  value: string
  children: React.ReactNode
  className?: string
  disabled?: boolean
  /** Optional leading icon slot — a lucide-react icon at `size-4`. It takes
   * the tab's ink. */
  leading?: React.ReactNode
  /** Optional count, set as a quiet number after the label. */
  count?: React.ReactNode
}

export function TabsTrigger({
  value,
  children,
  className,
  disabled,
  leading,
  count,
}: TabsTriggerProps) {
  const { value: selectedValue, onValueChange, orientation, registerIndicator } = useTabsContext()
  const isSelected = selectedValue === value
  const vertical = orientation === 'vertical'
  const indicatorRef = React.useCallback(
    (node: HTMLSpanElement | null) => (node ? registerIndicator(value, node) : undefined),
    [registerIndicator, value],
  )

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      disabled={disabled}
      onClick={() => onValueChange(value)}
      data-slot="tabs-trigger"
      data-state={isSelected ? 'active' : 'inactive'}
      className={cn(
        'relative inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium outline-none transition-colors duration-200',
        vertical && 'isolate justify-start',
        isSelected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        'focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
    >
      <span
        ref={indicatorRef}
        aria-hidden="true"
        data-slot="tabs-indicator"
        className={cn(
          'pointer-events-none absolute origin-top-left',
          vertical ? 'inset-0 -z-10 rounded-md bg-surface-muted' : 'inset-x-0 -bottom-px h-0.5 bg-accent-strong',
          isSelected ? 'opacity-100' : 'opacity-0',
        )}
      />
      {leading ? (
        <span
          data-slot="tabs-trigger-leading"
          aria-hidden="true"
          className="inline-flex shrink-0 items-center justify-center"
        >
          {leading}
        </span>
      ) : null}
      <span className="min-w-0 truncate">
        {children}
        {count !== undefined && count !== null ? (
          <span data-slot="tabs-trigger-count" className="ml-1.5 tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
      </span>
    </button>
  )
}

export type TabsContentProps = {
  value: string
  children: React.ReactNode
  className?: string
}

export function TabsContent({ value, children, className }: TabsContentProps) {
  const { value: selectedValue, orientation, shownValueRef } = useTabsContext()
  const isSelected = selectedValue === value
  const panelRef = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    if (isSelected && shownValueRef.current !== value) fadeInPanel(panelRef.current)
  }, [isSelected, shownValueRef, value])

  if (!isSelected) {
    return null
  }

  return (
    <div
      ref={panelRef}
      role="tabpanel"
      data-slot="tabs-content"
      className={cn(
        orientation === 'vertical' ? 'flex-1 min-w-0' : 'mt-2',
        'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      {children}
    </div>
  )
}

export type TabsPanelProps = React.HTMLAttributes<HTMLDivElement> & {
  /** The selected tab. The panel fades in each time it changes. */
  value: string
}

/**
 * The panel for a strip whose page renders the selected tab's content itself
 * rather than through `TabsContent`. It stays mounted, so the content keeps
 * its state, and fades in on every change of `value` after the first render,
 * as `TabsContent` does.
 */
export function TabsPanel({ value, className, children, ...rest }: TabsPanelProps) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const shownValue = React.useRef(value)

  React.useLayoutEffect(() => {
    if (shownValue.current === value) return
    shownValue.current = value
    fadeInPanel(panelRef.current)
  }, [value])

  return (
    <div ref={panelRef} role="tabpanel" data-slot="tabs-panel" className={className} {...rest}>
      {children}
    </div>
  )
}
