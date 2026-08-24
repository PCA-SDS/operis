import '@testing-library/jest-dom'

// Mock Response/Request/Headers for tests that need them in jsdom environment
// These are available natively in Node 18+ but jsdom doesn't expose them
class MockResponse {
  body: string
  status: number
  ok: boolean
  headers: Map<string, string>

  constructor(body: string = '', init: { status?: number; headers?: Record<string, string> } = {}) {
    this.body = body
    this.status = init.status ?? 200
    this.ok = this.status >= 200 && this.status < 300
    this.headers = new Map(Object.entries(init.headers ?? {}))
  }

  async json() {
    return JSON.parse(this.body)
  }

  async text() {
    return this.body
  }

  clone() {
    const cloned = new MockResponse(this.body, { status: this.status })
    cloned.headers = new Map(this.headers)
    return cloned
  }
}

if (typeof globalThis.Response === 'undefined') {
  (globalThis as any).Response = MockResponse
}

// jsdom does not implement ResizeObserver. Components like AppShell (sticky sidebar
// scroll affordance) and TruncatedCell instantiate one in effects, so any test that
// renders them needs a stub. Provide a no-op global mock instead of forcing every
// test file to ship its own.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as any).ResizeObserver = ResizeObserverStub
}

// Mock window.location.reload globally for all tests
if (typeof window !== 'undefined' && window.location) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window.location as any).reload
  } catch (e) {
    // Ignore if property can't be deleted
  }

  try {
    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    })
  } catch (e) {
    // If we still can't define it, try direct assignment
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.location as any).reload = jest.fn()
    } catch (innerError) {
      // If all else fails, silently ignore - window.location.reload is completely locked
    }
  }
}

// jsdom does not implement matchMedia. framer-motion's `useReducedMotion` —
// used by Dropdown and SegmentedControl to honour `prefers-reduced-motion` —
// calls it during render, so without this every test rendering a motion
// component throws. Reports "no preference" so tests exercise the animated
// path by default; a test that wants the reduced path can override the mock.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      // Deprecated pair, still probed by some libraries.
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

// jsdom implements no scrolling, so `Element.prototype.scrollIntoView` is
// absent. Dropdown calls it to keep the active option inside the menu's scroll
// viewport during keyboard navigation. Stub it globally rather than guarding
// the call site — in a real browser it always exists.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}
