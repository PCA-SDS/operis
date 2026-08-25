/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { TruncatedCell } from '../TruncatedCell'

// Installed before TruncatedCell first renders so the component's lazily-created
// shared observer is this recording one. The component only touches
// ResizeObserver at render time, and this module-level assignment runs after the
// hoisted imports but before any test body, so a static import is safe.
const observerLog = {
  observed: [] as Element[],
  unobserved: [] as Element[],
  instances: 0,
}

class RecordingResizeObserver {
  constructor(_callback: ResizeObserverCallback) {
    observerLog.instances += 1
  }
  observe(target: Element): void { observerLog.observed.push(target) }
  unobserve(target: Element): void { observerLog.unobserved.push(target) }
  disconnect(): void {}
}

;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RecordingResizeObserver

const CLIENT_WIDTH = 100
let scrollWidth = 0

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get: () => scrollWidth,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => CLIENT_WIDTH,
  })
})

beforeEach(() => {
  observerLog.observed = []
  observerLog.unobserved = []
  scrollWidth = 0
})

function liveContentNode(): Element {
  const node = document.querySelector('.overflow-hidden')
  if (!node) throw new Error('[internal] content node not rendered')
  return node
}

describe('TruncatedCell', () => {
  it('renders children and does not wrap in a tooltip when content fits', () => {
    scrollWidth = 50
    render(<TruncatedCell tooltipContent="Full value">Short</TruncatedCell>)

    expect(screen.getByText('Short')).toBeInTheDocument()
    // Radix renders the trigger with aria-describedby wiring only when mounted.
    expect(document.querySelector('[data-state]')).toBeNull()
  })

  it('re-observes the new node when flipping to truncated remounts the div', () => {
    // Regression: `isTruncated` swaps the returned tree from a bare <div> to
    // <SimpleTooltip><div/></SimpleTooltip>. React sees a different element type
    // at that position and rebuilds the node, so observation must follow it.
    scrollWidth = 500
    render(<TruncatedCell tooltipContent="Full value">Long value</TruncatedCell>)

    const current = liveContentNode()
    expect(observerLog.observed.length).toBeGreaterThanOrEqual(2)
    expect(observerLog.observed[observerLog.observed.length - 1]).toBe(current)
    // The first (pre-remount) node was released rather than leaked.
    expect(observerLog.unobserved).toContain(observerLog.observed[0])
    expect(observerLog.observed[0]).not.toBe(current)
  })

  it('does not churn observers when the parent re-renders with a new children element', () => {
    // The host rebuilds the cell element on every table render (flexRender).
    // Keying observation on it was the original per-render teardown/create cost.
    scrollWidth = 50
    const { rerender } = render(
      <TruncatedCell tooltipContent="Same text"><span>Same text</span></TruncatedCell>,
    )
    const afterMount = observerLog.observed.length

    for (let i = 0; i < 5; i += 1) {
      rerender(<TruncatedCell tooltipContent="Same text"><span>Same text</span></TruncatedCell>)
    }

    expect(observerLog.observed.length).toBe(afterMount)
    expect(observerLog.unobserved).toHaveLength(0)
  })

  it('shares a single ResizeObserver across many cells', () => {
    const before = observerLog.instances
    scrollWidth = 50
    render(
      <>
        {Array.from({ length: 25 }, (_, i) => (
          <TruncatedCell key={i} tooltipContent={`v${i}`}>{`v${i}`}</TruncatedCell>
        ))}
      </>,
    )

    // At most one new observer is constructed no matter how many cells mount.
    expect(observerLog.instances - before).toBeLessThanOrEqual(1)
    expect(observerLog.observed).toHaveLength(25)
  })

  it('re-measures when the text changes inside an unchanged box', () => {
    // ResizeObserver never fires here (the box is identical), so the explicit
    // text-keyed re-check is the only thing that can update the state.
    scrollWidth = 50
    const { rerender } = render(<TruncatedCell tooltipContent="short">short</TruncatedCell>)
    expect(document.querySelector('[data-state]')).toBeNull()

    scrollWidth = 500
    rerender(<TruncatedCell tooltipContent="a much longer value">a much longer value</TruncatedCell>)

    expect(screen.getByText('a much longer value')).toBeInTheDocument()
    expect(observerLog.observed[observerLog.observed.length - 1]).toBe(liveContentNode())
  })

  it('releases its observation on unmount', () => {
    scrollWidth = 50
    const { unmount } = render(<TruncatedCell tooltipContent="v">v</TruncatedCell>)
    const node = liveContentNode()

    unmount()

    expect(observerLog.unobserved).toContain(node)
  })

  it('passes children straight through when disabled', () => {
    scrollWidth = 500
    render(<TruncatedCell disabled tooltipContent="Full">Raw</TruncatedCell>)

    expect(screen.getByText('Raw')).toBeInTheDocument()
    expect(document.querySelector('.overflow-hidden')).toBeNull()
    expect(observerLog.observed).toHaveLength(0)
  })
})
