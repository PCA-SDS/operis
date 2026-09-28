/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CollapsibleZoneLayout, useZoneToggleSlot } from '../crud/CollapsibleZoneLayout'

function TabRow() {
  const toggle = useZoneToggleSlot()
  return (
    <div data-testid="tab-row">
      {toggle}
      <span>Tabs</span>
    </div>
  )
}

let currentWidth = 1400
let resizeObserverTarget: Element | null = null
let resizeObserverInstance: ResizeObserverMock | null = null
let desktopViewport = true
const mediaQueryListeners = new Set<() => void>()

function createResizeEntry(target: Element, width: number): ResizeObserverEntry {
  return {
    target,
    contentRect: {
      width,
      height: 0,
      x: 0,
      y: 0,
      top: 0,
      right: width,
      bottom: 0,
      left: 0,
      toJSON: () => ({}),
    } as DOMRectReadOnly,
  } as ResizeObserverEntry
}

class ResizeObserverMock {
  readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    resizeObserverInstance = this
  }

  observe(target: Element) {
    resizeObserverTarget = target
    this.callback([createResizeEntry(target, currentWidth)], this as unknown as ResizeObserver)
  }

  unobserve() {}

  disconnect() {
    resizeObserverTarget = null
  }
}

function setContainerWidth(width: number) {
  currentWidth = width
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  })
  if (!resizeObserverTarget || !resizeObserverInstance) return
  resizeObserverInstance.callback(
    [createResizeEntry(resizeObserverTarget, width)],
    resizeObserverInstance as unknown as ResizeObserver,
  )
}

describe('CollapsibleZoneLayout', () => {
  beforeEach(() => {
    currentWidth = 1400
    desktopViewport = true
    resizeObserverTarget = null
    resizeObserverInstance = null
    mediaQueryListeners.clear()
    localStorage.clear()

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: currentWidth,
    })
    const requestAnimationFrameMock = (callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(0), 0)
    }
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: requestAnimationFrameMock,
    })
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: requestAnimationFrameMock,
    })

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        matches: desktopViewport,
        media: '(min-width: 1024px)',
        onchange: null,
        addEventListener: (_event: string, listener: () => void) => {
          mediaQueryListeners.add(listener)
        },
        removeEventListener: (_event: string, listener: () => void) => {
          mediaQueryListeners.delete(listener)
        },
        addListener: (listener: () => void) => {
          mediaQueryListeners.add(listener)
        },
        removeListener: (listener: () => void) => {
          mediaQueryListeners.delete(listener)
        },
        dispatchEvent: () => true,
      })),
    })

    ;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverMock }).ResizeObserver = ResizeObserverMock
  })

  it('auto-collapses zone1 before the two-column layout becomes too narrow', async () => {
    const { container } = renderWithProviders(
      <CollapsibleZoneLayout
        zone1={<div>Zone 1</div>}
        zone2={<div>Zone 2</div>}
        entityName="Brightside Solar"
        pageType="company-v2"
      />,
      { dict: {} },
    )

    const layout = container.firstElementChild as HTMLElement

    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'side-by-side')
    })

    act(() => {
      setContainerWidth(1180)
    })

    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'collapsed')
    })

    // Folded away rather than removed: out of reach and out of the a11y tree.
    const zone1Column = container.querySelector('[data-zone1]') as HTMLElement
    expect(zone1Column).toHaveAttribute('inert')
    expect(zone1Column).toHaveAttribute('aria-hidden', 'true')
    expect(zone1Column.style.gridTemplateColumns).toBe('0fr')
    expect(screen.getByRole('button', { name: 'Expand form panel' })).toBeInTheDocument()
  })

  it('folds the form column instead of unmounting it, so typed values survive a collapse', async () => {
    const { container } = renderWithProviders(
      <CollapsibleZoneLayout
        zone1={<input aria-label="Name" defaultValue="" />}
        zone2={<div>Zone 2</div>}
        entityName="Brightside Solar"
        pageType="person-v2-fold"
      />,
      { dict: {} },
    )
    const layout = container.firstElementChild as HTMLElement
    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'side-by-side')
    })
    const input = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Ada' } })

    const zone1Column = container.querySelector('[data-zone1]') as HTMLElement
    expect(zone1Column.style.gridTemplateColumns).toBe('1fr')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse form panel' }))
    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'collapsed')
    })
    expect(zone1Column.style.gridTemplateColumns).toBe('0fr')

    fireEvent.click(screen.getByRole('button', { name: 'Expand form panel' }))
    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'side-by-side')
    })
    // The same input, still holding what was typed before the fold.
    expect(screen.getByRole('textbox', { name: 'Name' })).toBe(input)
    expect(input.value).toBe('Ada')
  })

  it('shows and hides the form with one sidebar button that never leaves its place', async () => {
    const { container } = renderWithProviders(
      <CollapsibleZoneLayout
        zone1={<div>Zone 1</div>}
        zone2={<div>Zone 2</div>}
        entityName="Brightside Solar"
        pageType="person-v2-toggle"
      />,
      { dict: {} },
    )
    const layout = container.firstElementChild as HTMLElement
    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'side-by-side')
    })
    const toggle = screen.getByRole('button', { name: 'Collapse form panel' })
    const zone1Column = container.querySelector('[data-zone1]') as HTMLElement
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', zone1Column.id)
    // The button leads zone 2's row, so it sits beside the tabs in every state.
    expect(toggle.closest('[data-zone-toggle]')?.nextElementSibling).toHaveTextContent('Zone 2')

    fireEvent.click(toggle)
    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'collapsed')
    })
    expect(screen.getByRole('button', { name: 'Expand form panel' })).toBe(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // Collapsed is the form folded away, with nothing drawn in its place.
    expect(screen.getAllByRole('button')).toEqual([toggle])
  })

  it('stacks zone1 above zone2 when the user expands it in constrained space', async () => {
    currentWidth = 1180
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: currentWidth,
    })

    const { container } = renderWithProviders(
      <CollapsibleZoneLayout
        zone1={<div>Zone 1</div>}
        zone2={<div>Zone 2</div>}
        entityName="Brightside Solar"
        pageType="person-v2"
      />,
      { dict: {} },
    )

    const layout = container.firstElementChild as HTMLElement

    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'collapsed')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Expand form panel' }))

    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'stacked')
    })

    const zone1 = screen.getByText('Zone 1')
    const zone2 = screen.getByText('Zone 2')

    expect(zone1.compareDocumentPosition(zone2) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(screen.getByRole('button', { name: 'Collapse form panel' })).toBeInTheDocument()
  })

  it('keeps the sidebar button beside zone 2 when the form stacks above it', async () => {
    currentWidth = 1180
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: currentWidth,
    })
    const { container } = renderWithProviders(
      <CollapsibleZoneLayout
        zone1={<input aria-label="Name" defaultValue="" />}
        zone2={<div>Zone 2</div>}
        entityName="Ada Lovelace"
        pageType="person-v2-stacked"
      />,
      { dict: {} },
    )
    const layout = container.firstElementChild as HTMLElement
    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'collapsed')
    })
    const input = screen.getByRole('textbox', { hidden: true, name: 'Name' }) as HTMLInputElement
    const toggle = screen.getByRole('button', { name: 'Expand form panel' })
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'stacked')
    })
    expect(screen.getByRole('button', { name: 'Collapse form panel' })).toBe(toggle)
    expect(toggle.closest('[data-zone-toggle]')?.nextElementSibling).toHaveTextContent('Zone 2')
    // Stacking rearranges the one tree rather than drawing a second form.
    expect(screen.getByRole('textbox', { name: 'Name' })).toBe(input)
  })

  it('lets the tab row take the sidebar button, so the content under it spans zone 2', async () => {
    const { container } = renderWithProviders(
      <CollapsibleZoneLayout
        zone1={<div>Zone 1</div>}
        zone2={(
          <div>
            <TabRow />
            <div>Cards</div>
          </div>
        )}
        entityName="Brightside Solar"
        pageType="person-v2-claimed"
      />,
      { dict: {} },
    )
    const layout = container.firstElementChild as HTMLElement
    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'side-by-side')
    })
    const toggle = screen.getByRole('button', { name: 'Collapse form panel' })
    expect(screen.getByTestId('tab-row')).toContainElement(toggle)
    // The layout drew no column of its own for it.
    expect(container.querySelector('[data-zone-toggle]')).toBeNull()

    fireEvent.click(toggle)
    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'collapsed')
    })
    expect(screen.getByRole('button', { name: 'Expand form panel' })).toBe(toggle)
  })

  it('gives nothing to a tab row outside the layout', () => {
    renderWithProviders(<TabRow />, { dict: {} })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('draws no sidebar button below the desktop breakpoint', async () => {
    desktopViewport = false
    const { container } = renderWithProviders(
      <CollapsibleZoneLayout zone1={<div>Zone 1</div>} zone2={<div>Zone 2</div>} entityName="Brightside Solar" pageType="mobile" />,
      { dict: {} },
    )
    const layout = container.firstElementChild as HTMLElement
    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'side-by-side')
    })
    expect(screen.queryByRole('button')).toBeNull()
  })
})
