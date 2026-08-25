/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { RowActions, type RowActionItem } from '../RowActions'

const DICT = {}

function Harness({ items, onRender }: { items: RowActionItem[]; onRender?: () => void }) {
  return (
    <I18nProvider locale="en" dict={DICT}>
      <React.Profiler id="row-actions" onRender={() => { onRender?.() }}>
        <RowActions items={items} />
      </React.Profiler>
    </I18nProvider>
  )
}

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect

let anchorRect = { top: 100, left: 200, bottom: 130, right: 240 }
let rafQueue: FrameRequestCallback[] = []
let rafRequests = 0

function makeRect(): DOMRect {
  return {
    ...anchorRect,
    width: anchorRect.right - anchorRect.left,
    height: anchorRect.bottom - anchorRect.top,
    x: anchorRect.left,
    y: anchorRect.top,
    toJSON: () => ({}),
  } as DOMRect
}

function flushFrames(): void {
  const queue = rafQueue
  rafQueue = []
  act(() => {
    for (const cb of queue) cb(0)
  })
}

beforeEach(() => {
  anchorRect = { top: 100, left: 200, bottom: 130, right: 240 }
  rafQueue = []
  rafRequests = 0
  // Browsers hand back a fresh DOMRect for every measurement, so identity
  // comparison alone would always look "changed".
  Element.prototype.getBoundingClientRect = function getBoundingClientRectStub() {
    return makeRect()
  }
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    rafRequests += 1
    rafQueue.push(cb)
    return rafQueue.length
  })
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
})

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
  jest.restoreAllMocks()
})

function openMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Open actions' }))
  flushFrames()
}

describe('RowActions — scroll repositioning', () => {
  it('coalesces a burst of scroll events into a single animation frame', () => {
    render(<Harness items={[{ id: 'edit', label: 'Edit', onSelect: jest.fn() }]} />)
    openMenu()

    const before = rafRequests
    for (let i = 0; i < 5; i += 1) {
      fireEvent.scroll(window)
    }
    expect(rafRequests - before).toBe(1)
  })

  it('does not re-render while scrolling when the anchor rect is unchanged', () => {
    let commits = 0
    render(<Harness items={[{ id: 'edit', label: 'Edit', onSelect: jest.fn() }]} onRender={() => { commits += 1 }} />)
    openMenu()
    expect(screen.getByRole('menu')).toBeInTheDocument()

    const commitsAfterOpen = commits
    for (let i = 0; i < 5; i += 1) {
      fireEvent.scroll(window)
    }
    flushFrames()

    expect(commits).toBe(commitsAfterOpen)
  })

  it('re-renders once when the anchor rect actually moves', () => {
    let commits = 0
    render(<Harness items={[{ id: 'edit', label: 'Edit', onSelect: jest.fn() }]} onRender={() => { commits += 1 }} />)
    openMenu()

    const commitsAfterOpen = commits
    anchorRect = { top: 60, left: 200, bottom: 90, right: 240 }
    fireEvent.scroll(window)
    flushFrames()

    expect(commits).toBe(commitsAfterOpen + 1)
    expect(screen.getByRole('menu')).toHaveStyle({ top: '98px' })
  })
})

describe('RowActions — in-flight actions', () => {
  it('renders a caller-declared loading item disabled and swallows its clicks', () => {
    const onSelect = jest.fn()
    render(<Harness items={[{ id: 'delete', label: 'Delete', destructive: true, loading: true, onSelect }]} />)
    openMenu()

    const item = screen.getByRole('menuitem', { name: 'Delete' })
    expect(item).toBeDisabled()
    expect(item).toHaveAttribute('aria-busy', 'true')

    fireEvent.click(item)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('renders a caller-declared disabled item without a spinner and swallows its clicks', () => {
    const onSelect = jest.fn()
    render(<Harness items={[{ id: 'delete', label: 'Delete', disabled: true, onSelect }]} />)
    openMenu()

    const item = screen.getByRole('menuitem', { name: 'Delete' })
    expect(item).toBeDisabled()
    expect(item).not.toHaveAttribute('aria-busy')

    fireEvent.click(item)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('holds an async action disabled until it settles so a second click cannot re-fire it', async () => {
    let resolveDelete: (() => void) | undefined
    const onSelect = jest.fn(() => new Promise<void>((resolve) => { resolveDelete = () => resolve() }))
    render(<Harness items={[{ id: 'delete', label: 'Delete', destructive: true, onSelect }]} />)

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    // Menu closes on activation exactly as before.
    expect(screen.queryByRole('menu')).toBeNull()

    openMenu()
    const pendingItem = screen.getByRole('menuitem', { name: 'Delete' })
    expect(pendingItem).toBeDisabled()
    expect(pendingItem).toHaveAttribute('aria-busy', 'true')

    fireEvent.click(pendingItem)
    expect(onSelect).toHaveBeenCalledTimes(1)

    await act(async () => { resolveDelete?.() })
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Delete' })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('keeps a plain synchronous action enabled and fires it exactly as before', () => {
    const onSelect = jest.fn()
    render(<Harness items={[{ id: 'edit', label: 'Edit', onSelect }]} />)
    openMenu()

    const item = screen.getByRole('menuitem', { name: 'Edit' })
    expect(item).not.toBeDisabled()
    expect(item).not.toHaveAttribute('aria-busy')

    fireEvent.click(item)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
