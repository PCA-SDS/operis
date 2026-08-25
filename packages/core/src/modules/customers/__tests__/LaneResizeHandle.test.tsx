/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { LaneResizeHandle } from '../backend/customers/deals/pipeline/components/LaneResizeHandle'

/**
 * A high-polling mouse fires `pointermove` several times per displayed frame, and every
 * un-coalesced `onResize` commits React state on the deals-pipeline page. These tests pin
 * the coalescing contract: at most one `onResize` per animation frame, carrying the summed
 * delta, with the residual flushed on release so the final lane width is unchanged.
 */

let frames: Map<number, FrameRequestCallback>
let nextFrameId: number

function runPendingFrames(): void {
  const pending = Array.from(frames.values())
  frames.clear()
  act(() => {
    for (const callback of pending) callback(performance.now())
  })
}

function firePointer(type: 'pointermove' | 'pointerup', clientX?: number): void {
  act(() => {
    window.dispatchEvent(new MouseEvent(type, clientX === undefined ? {} : { clientX }))
  })
}

function renderHandle(props: React.ComponentProps<typeof LaneResizeHandle>) {
  return render(
    <I18nProvider locale="en" dict={{}}>
      <LaneResizeHandle {...props} />
    </I18nProvider>,
  )
}

// jsdom's PointerEvent does not carry `clientX`, so the drag is started with a
// bubbling MouseEvent of the same type — React dispatches it to `onPointerDown`.
function startDrag(clientX: number): void {
  fireEvent(
    screen.getByRole('separator'),
    new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX }),
  )
}

beforeEach(() => {
  frames = new Map()
  nextFrameId = 1
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = nextFrameId++
    frames.set(id, callback)
    return id
  })
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id)
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('LaneResizeHandle', () => {
  test('coalesces several pointermoves into a single onResize per animation frame', () => {
    const onResize = jest.fn()
    renderHandle({ onResize })

    startDrag(100)
    firePointer('pointermove', 105)
    firePointer('pointermove', 112)
    firePointer('pointermove', 120)

    // Three moves, one scheduled frame, nothing committed to React yet.
    expect(frames.size).toBe(1)
    expect(onResize).not.toHaveBeenCalled()

    runPendingFrames()

    expect(onResize).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenCalledWith(20)

    // The next batch schedules a fresh frame and reports only the new delta,
    // so the cumulative delta the page applies is unchanged.
    firePointer('pointermove', 130)
    expect(frames.size).toBe(1)
    runPendingFrames()

    expect(onResize).toHaveBeenCalledTimes(2)
    expect(onResize).toHaveBeenNthCalledWith(2, 10)
    expect(onResize.mock.calls.reduce((sum, [delta]) => sum + delta, 0)).toBe(30)
  })

  test('flushes the residual delta on pointerup so the released width is exact', () => {
    const onResize = jest.fn()
    const onResizeEnd = jest.fn()
    renderHandle({ onResize, onResizeEnd })

    startDrag(100)
    firePointer('pointermove', 150)
    // Release before the frame runs — the pending delta must not be dropped.
    firePointer('pointerup')

    expect(onResize).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenCalledWith(50)
    expect(onResizeEnd).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)

    // Listeners are detached: post-release movement must not resize.
    firePointer('pointermove', 400)
    expect(onResize).toHaveBeenCalledTimes(1)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  test('unmounting mid-drag cancels the pending frame and detaches listeners', () => {
    const onResize = jest.fn()
    const { unmount } = renderHandle({ onResize })

    startDrag(100)
    firePointer('pointermove', 160)
    expect(frames.size).toBe(1)

    unmount()

    expect(frames.size).toBe(0)
    firePointer('pointermove', 400)
    expect(onResize).not.toHaveBeenCalled()
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })
})
