"use client"

import * as React from 'react'
import { SimpleTooltip } from '../primitives/tooltip'
import { cn } from '@open-mercato/shared/lib/utils'

export type TruncatedCellProps = {
  children: React.ReactNode
  /** Maximum width for the cell content. Can be a Tailwind class (e.g., 'max-w-[200px]') or CSS value */
  maxWidth?: string
  /** Custom class name for the wrapper */
  className?: string
  /** Tooltip content - if not provided, will try to extract text from children */
  tooltipContent?: React.ReactNode
  /** Disable truncation and tooltip */
  disabled?: boolean
}

/**
 * Extracts text content from React nodes for tooltip display
 */
function extractTextContent(node: React.ReactNode): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (typeof node === 'boolean') return ''
  if (Array.isArray(node)) {
    return node.map(extractTextContent).join('')
  }
  if (React.isValidElement(node)) {
    // Handle React elements - extract text from props.children
    const props = node.props as Record<string, unknown>
    if (props) {
      // First try children
      if (props.children != null) {
        const childText = extractTextContent(props.children as React.ReactNode)
        if (childText) return childText
      }
      // Try common text props
      if (typeof props.value === 'string') return props.value
      if (typeof props.label === 'string') return props.label
      if (typeof props.title === 'string') return props.title
    }
  }
  // Try to convert to string as last resort
  if (node && typeof node === 'object' && 'toString' in node) {
    const str = String(node)
    if (str !== '[object Object]') return str
  }
  return ''
}

// A list view mounts one TruncatedCell per data cell — hundreds per page. Giving
// each its own ResizeObserver costs an allocation plus a separate browser-side
// observation record per cell, so every cell shares this one. Created lazily so
// server rendering never touches the constructor.
const truncationCallbacks = new WeakMap<Element, () => void>()
let sharedTruncationObserver: ResizeObserver | null = null

function observeTruncation(element: Element, onResize: () => void): () => void {
  truncationCallbacks.set(element, onResize)
  if (typeof ResizeObserver === 'undefined') {
    return () => { truncationCallbacks.delete(element) }
  }
  if (!sharedTruncationObserver) {
    sharedTruncationObserver = new ResizeObserver((entries) => {
      for (const entry of entries) truncationCallbacks.get(entry.target)?.()
    })
  }
  const observer = sharedTruncationObserver
  observer.observe(element)
  return () => {
    truncationCallbacks.delete(element)
    observer.unobserve(element)
  }
}

/**
 * A cell wrapper that truncates content and shows a tooltip on hover
 * only when the content is wider than the available space.
 *
 * @example
 * <TruncatedCell maxWidth="max-w-[200px]">
 *   <span>This is a very long text that will be truncated</span>
 * </TruncatedCell>
 */
export function TruncatedCell({
  children,
  maxWidth = 'max-w-[150px]',
  className,
  tooltipContent,
  disabled = false,
}: TruncatedCellProps) {
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const unobserveRef = React.useRef<(() => void) | null>(null)
  const [isTruncated, setIsTruncated] = React.useState(false)

  // Get tooltip content - prefer explicit tooltipContent, fall back to extracting from children
  const resolvedTooltipContent = tooltipContent ?? extractTextContent(children)

  // Re-measurement keys off the rendered *text*, not the `children` element: the
  // host rebuilds that element on every render (flexRender), so keying on it
  // re-ran the effect for every cell on every table render. ResizeObserver only
  // reports box changes, so a cell whose text changed inside an unchanged box
  // (paging a list) still needs this explicit re-check.
  const truncationKey = typeof resolvedTooltipContent === 'string'
    ? resolvedTooltipContent
    : extractTextContent(children)

  const measureTruncation = React.useCallback(() => {
    const el = contentRef.current
    if (!el) return
    const next = el.scrollWidth > el.clientWidth
    setIsTruncated((prev) => (prev === next ? prev : next))
  }, [])

  // A callback ref, not an effect: this div is genuinely remounted during the
  // component's life. Flipping `isTruncated` swaps the returned tree between a
  // bare <div> and <SimpleTooltip><div/></SimpleTooltip>, and toggling
  // `disabled` drops it entirely — both give React a different element type at
  // this position, so it destroys the node and builds a new one. A mount-only
  // effect would keep observing the detached node and silently stop reacting to
  // column resizes. The ref fires on every attach and detach, so observation
  // always follows the live node.
  const setContentNode = React.useCallback((node: HTMLDivElement | null) => {
    unobserveRef.current?.()
    unobserveRef.current = null
    contentRef.current = node
    if (!node) return
    unobserveRef.current = observeTruncation(node, measureTruncation)
    measureTruncation()
  }, [measureTruncation])

  // ResizeObserver only reports box changes, so a cell whose text changed inside
  // an unchanged box (paging a list) needs this explicit re-check.
  React.useEffect(() => {
    measureTruncation()
  }, [measureTruncation, truncationKey, maxWidth])

  if (disabled) {
    return <>{children}</>
  }

  // Determine if maxWidth is a Tailwind class or a CSS value
  const isTailwindClass = maxWidth.startsWith('max-w-')
  const styleMaxWidth = isTailwindClass ? undefined : maxWidth
  const classMaxWidth = isTailwindClass ? maxWidth : ''

  const content = (
    <div
      ref={setContentNode}
      className={cn(
        'overflow-hidden text-ellipsis whitespace-nowrap',
        classMaxWidth,
        className
      )}
      style={styleMaxWidth ? { maxWidth: styleMaxWidth } : undefined}
    >
      {children}
    </div>
  )

  // Only show tooltip when content is actually truncated
  if (!resolvedTooltipContent || !isTruncated) {
    return content
  }

  return (
    <SimpleTooltip
      content={resolvedTooltipContent}
      side="top"
      delayDuration={300}
    >
      {content}
    </SimpleTooltip>
  )
}
