/**
 * @jest-environment jsdom
 */

/**
 * The contextual region beside the transcript.
 *
 * Two behaviours carry the weight here: the region takes real layout width
 * rather than covering the conversation, and it stops trying to do that on a
 * container too small to hold both — where two unusable columns would be worse
 * than one usable one.
 */

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ChatContextPanel } from '../components/ChatContextPanel'
import { CHAT_PANEL_WIDTH, maxPanelWidthFor } from '../components/contextPanel'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: unknown, params?: Record<string, unknown>) => {
    const text = typeof fallback === 'string' ? fallback : String(_key)
    if (!params) return text
    return Object.entries(params).reduce(
      (acc, [name, value]) => acc.replace(`{${name}}`, String(value)),
      text,
    )
  },
  useLocale: () => 'en',
}))

const CONTAINER = 1600

function setup(overrides: Partial<React.ComponentProps<typeof ChatContextPanel>> = {}) {
  const onClose = overrides.onClose ?? jest.fn()
  const onWidthChange = overrides.onWidthChange ?? jest.fn()
  const onResetWidth = overrides.onResetWidth ?? jest.fn()
  render(
    <ChatContextPanel
      open
      split
      title="Pinned messages"
      width={340}
      containerWidth={CONTAINER}
      onClose={onClose}
      onWidthChange={onWidthChange}
      onResetWidth={onResetWidth}
      {...overrides}
    >
      <p>panel body</p>
    </ChatContextPanel>,
  )
  return { onClose, onWidthChange, onResetWidth }
}

describe('split mode', () => {
  it('takes layout width instead of covering the conversation', () => {
    setup()
    const region = screen.getByRole('complementary', { name: 'Pinned messages' })
    // A dialog would trap focus and paint a backdrop over the transcript. The
    // whole point of this change is that the conversation stays usable.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(region.style.width).toBe('340px')
  })

  it('renders its content and a titled header', () => {
    setup()
    expect(screen.getByText('panel body')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Pinned messages' })).toBeTruthy()
  })

  it('closes from a control that has an accessible name', () => {
    const { onClose } = setup()
    // Not a bare icon: a close control nobody can name is one a screen-reader
    // user cannot find (§21).
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing at all when closed', () => {
    const { container } = render(
      <ChatContextPanel
        open={false}
        split
        title="Pinned messages"
        width={340}
        containerWidth={CONTAINER}
        onClose={jest.fn()}
        onWidthChange={jest.fn()}
        onResetWidth={jest.fn()}
      >
        <p>panel body</p>
      </ChatContextPanel>,
    )
    expect(container.firstChild).toBeNull()
  })
})

describe('the divider', () => {
  function separator() {
    return screen.getByRole('separator', { name: 'Resize panel' })
  }

  it('announces its current width and its limits', () => {
    setup()
    const handle = separator()
    expect(handle.getAttribute('aria-valuenow')).toBe('340')
    expect(handle.getAttribute('aria-valuemin')).toBe(String(CHAT_PANEL_WIDTH.min))
    expect(handle.getAttribute('aria-valuemax')).toBe(String(maxPanelWidthFor(CONTAINER)))
    expect(handle.getAttribute('aria-orientation')).toBe('vertical')
  })

  it('is reachable by keyboard', () => {
    setup()
    // A splitter only a mouse can move is a splitter some people simply do not
    // have (§33).
    expect(separator().getAttribute('tabindex')).toBe('0')
  })

  it('widens the panel on ArrowLeft and narrows it on ArrowRight', () => {
    const { onWidthChange } = setup()
    // Dragging the edge leftward gives the panel more room; the arrow keys have
    // to agree with the pointer or the two gestures contradict each other (§5).
    fireEvent.keyDown(separator(), { key: 'ArrowLeft' })
    expect(onWidthChange).toHaveBeenLastCalledWith(356)

    fireEvent.keyDown(separator(), { key: 'ArrowRight' })
    expect(onWidthChange).toHaveBeenLastCalledWith(324)
  })

  it('takes a bigger step with shift held', () => {
    const { onWidthChange } = setup()
    fireEvent.keyDown(separator(), { key: 'ArrowLeft', shiftKey: true })
    expect(onWidthChange).toHaveBeenLastCalledWith(404)
  })

  it('clamps keyboard resizing to the same limits as dragging', () => {
    const { onWidthChange } = setup({ width: CHAT_PANEL_WIDTH.min })
    fireEvent.keyDown(separator(), { key: 'ArrowRight' })
    expect(onWidthChange).toHaveBeenLastCalledWith(CHAT_PANEL_WIDTH.min)

    fireEvent.keyDown(separator(), { key: 'Home' })
    expect(onWidthChange).toHaveBeenLastCalledWith(maxPanelWidthFor(CONTAINER))
  })

  it('restores the default width on double click', () => {
    const { onResetWidth } = setup()
    fireEvent.doubleClick(separator())
    expect(onResetWidth).toHaveBeenCalledTimes(1)
  })
})

describe('constrained containers', () => {
  it('becomes an overlay rather than squeezing two unusable columns', () => {
    setup({ split: false, containerWidth: 600 })
    // Below the split threshold the conversation cannot afford to give up
    // width, so the same content arrives as a drawer instead (§10, §55).
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'Pinned messages' })).toBeNull()
    expect(screen.getByText('panel body')).toBeTruthy()
  })

  it('offers no divider when there is nothing to divide', () => {
    setup({ split: false, containerWidth: 600 })
    // Precision dragging on a phone is not a feature (§50).
    expect(screen.queryByRole('separator', { name: 'Resize panel' })).toBeNull()
  })
})

describe('reacting to a container that changes size', () => {
  /**
   * The mode is a function of the measured container, so the measurement has to
   * keep up. A window dragged narrower while the panel is open must move the
   * region to a drawer rather than leave a 168px transcript beside it — and
   * that only happens if the observer's callback actually re-renders the
   * caller (§52).
   *
   * Asserted here rather than in a browser because `ResizeObserver` is
   * delivered on the rendering lifecycle, which a background tab does not run.
   */
  const observers: { callback: ResizeObserverCallback; target: Element | null }[] = []

  beforeEach(() => {
    observers.length = 0
    class FakeResizeObserver {
      constructor(public callback: ResizeObserverCallback) {
        observers.push({ callback, target: null })
      }
      observe(target: Element) {
        const entry = observers.find((o) => o.callback === this.callback)
        if (entry) entry.target = target
      }
      unobserve() {}
      disconnect() {}
    }
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver
  })

  function emit(width: number) {
    for (const observer of observers) {
      observer.callback(
        [{ contentRect: { width } } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      )
    }
  }

  function Harness() {
    const { useContainerWidth } = require('../components/contextPanel') as typeof import('../components/contextPanel')
    const [ref, width] = useContainerWidth<HTMLDivElement>()
    return (
      <div ref={ref} data-testid="box">
        {width}
      </div>
    )
  }

  it('reports the new width when the container is resized', () => {
    const { getByTestId } = render(<Harness />)
    act(() => emit(1600))
    expect(getByTestId('box').textContent).toBe('1600')

    // The narrowing that must flip a split into a drawer.
    act(() => emit(452))
    expect(getByTestId('box').textContent).toBe('452')
  })

  it('attaches even when the ref lands on a later render', () => {
    // The measured component returns a different tree while loading, which does
    // not carry the ref. A plain `useRef` read once in a mount effect finds
    // nothing and never observes anything at all — the layout then stays in its
    // fallback mode for the life of the mount.
    function Late() {
      const { useContainerWidth } = require('../components/contextPanel') as typeof import('../components/contextPanel')
      const [ref, width] = useContainerWidth<HTMLDivElement>()
      const [ready, setReady] = React.useState(false)
      React.useEffect(() => setReady(true), [])
      if (!ready) return <span>loading</span>
      return (
        <div ref={ref} data-testid="late">
          {width}
        </div>
      )
    }
    const { getByTestId } = render(<Late />)
    act(() => emit(900))
    expect(getByTestId('late').textContent).toBe('900')
  })
})

describe('surviving a conversation switch', () => {
  /**
   * `ChatShell` renders `ConversationView` with `key={conversationId}`, so
   * switching conversations deliberately remounts the view and clears its
   * per-conversation state. The contextual region must NOT be cleared with it:
   * a panel the reader opened should re-point at the new conversation rather
   * than disappear every time they move (§18).
   *
   * This pins the structural reason that works — the state is held above the
   * key — by asserting the child really does remount while the region's state
   * survives.
   */
  function Harness({ conversationId }: { conversationId: string }) {
    const { useChatContextPanel } = require('../components/contextPanel') as typeof import('../components/contextPanel')
    const panel = useChatContextPanel()
    return (
      <div>
        <button type="button" onClick={() => panel.open('pins')}>
          open pins
        </button>
        <span data-testid="kind">{panel.kind ?? 'closed'}</span>
        <span data-testid="width">{panel.width}</span>
        <Child key={conversationId} conversationId={conversationId} />
      </div>
    )
  }

  let mounts = 0
  function Child({ conversationId }: { conversationId: string }) {
    React.useEffect(() => {
      mounts += 1
    }, [])
    return <span data-testid="child">{conversationId}</span>
  }

  it('keeps the region open when the keyed child remounts', () => {
    mounts = 0
    const { rerender, getByTestId, getByText } = render(<Harness conversationId="a" />)
    fireEvent.click(getByText('open pins'))
    expect(getByTestId('kind').textContent).toBe('pins')
    expect(mounts).toBe(1)

    rerender(<Harness conversationId="b" />)

    // The child really did remount — otherwise this test would prove nothing.
    expect(mounts).toBe(2)
    expect(getByTestId('child').textContent).toBe('b')
    // ...and the region is still open, now pointing at the new conversation.
    expect(getByTestId('kind').textContent).toBe('pins')
  })

  it('keeps the chosen width across the switch', () => {
    const { rerender, getByTestId } = render(<Harness conversationId="a" />)
    const before = getByTestId('width').textContent
    rerender(<Harness conversationId="b" />)
    expect(getByTestId('width').textContent).toBe(before)
  })
})
