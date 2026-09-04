/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MessageList } from '../components/MessageList'
import type { ChatMessageDto } from '../data/types'

/**
 * The real `useT` substitutes `{name}` placeholders from the third argument.
 * The mock does too, because several strings here — the system lines especially
 * — are only meaningful once their names are in them; a mock that returned the
 * raw fallback would let a component ship `{actor} added {target}` to a user and
 * still pass.
 */
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT:
    () =>
    (key: string, fallback?: unknown, params?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : String(key)
      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      )
    },
  useLocale: () => 'en',
}))

/**
 * jsdom implements no layout and no scrolling: `scrollTo` does not exist and
 * every metric reads 0. These tests give the scroll container a fake geometry
 * and record what the component asks it to scroll to, which is the decision
 * being made — a pixel offset would be asserting jsdom's zeroes.
 */
const SCROLL_HEIGHT = 2000
const CLIENT_HEIGHT = 500

type ScrollCall = { top: number; behavior?: ScrollBehavior }
let scrollCalls: ScrollCall[] = []
let scrollTopValue = 0

function transcript(): HTMLElement {
  return document.querySelector('[role="region"][aria-label]') as HTMLElement
}

beforeEach(() => {
  scrollCalls = []
  scrollTopValue = 0
  // `scrollTo` actually moves the position, clamped the way a browser clamps it.
  // Recording the call without moving anything left the container reading as
  // scrolled to the top forever, so the follow-the-bottom branch could never be
  // reached and a test for it would assert against a state the app never has.
  Element.prototype.scrollTo = function scrollTo(this: Element, options?: unknown) {
    const call = options as ScrollCall
    scrollCalls.push(call)
    scrollTopValue = Math.max(0, Math.min(call.top, SCROLL_HEIGHT - CLIENT_HEIGHT))
  } as typeof Element.prototype.scrollTo
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get: () => SCROLL_HEIGHT,
  })
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get: () => CLIENT_HEIGHT,
  })
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get: () => scrollTopValue,
    set: (next: number) => {
      scrollTopValue = next
    },
  })
})

const ME = 'user-me'
const THEM = 'user-them'

function message(overrides: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    id: 'm1',
    conversationId: 'conv-1',
    senderUserId: THEM,
    senderName: 'Bob',
    kind: 'user',
    body: 'hello',
    createdAt: '2026-09-02T10:00:00.000Z',
    clientMessageId: null,
    replyTo: null,
    systemEvent: null,
    systemTargetUserId: null,
    systemTargetName: null,
    ...overrides,
  }
}

function renderList(
  messages: ChatMessageDto[],
  pending: React.ComponentProps<typeof MessageList>['pending'] = [],
  extra: Partial<React.ComponentProps<typeof MessageList>> = {},
) {
  return render(
    <MessageList
      messages={messages}
      pending={pending}
      currentUserId={ME}
      conversationTitle="Bob"
      isSpace={false}
      isLoading={false}
      hasOlder={false}
      isLoadingOlder={false}
      onLoadOlder={jest.fn()}
      onRetryPending={jest.fn()}
      {...extra}
    />,
  )
}

/** Author lines carry the avatar; a grouped message has none. */
function authorLineCount(): number {
  return document.querySelectorAll('li > p > span.font-semibold').length
}

describe('MessageList', () => {
  it('renders message bodies as text, never as markup', () => {
    renderList([message({ body: '<img src=x onerror=alert(1)>' })])
    // The body appears verbatim: if it had been parsed as HTML, this literal
    // string would not be in the document and an <img> would be.
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('names the sender so mine and theirs are distinguishable', () => {
    renderList([message({ id: 'a', senderUserId: THEM }), message({ id: 'b', senderUserId: ME, createdAt: '2026-09-02T10:01:00.000Z' })])
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('groups a run from the same person under one author line', () => {
    renderList([
      message({ id: 'a', body: 'one' }),
      message({ id: 'b', body: 'two', createdAt: '2026-09-02T10:01:00.000Z' }),
      message({ id: 'c', body: 'three', createdAt: '2026-09-02T10:02:00.000Z' }),
    ])
    expect(screen.getAllByText('Bob')).toHaveLength(1)
  })

  it('separates days, and the separator is readable by assistive tech', () => {
    // Built relative to now so the assertion does not depend on the day the
    // suite happens to run.
    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    renderList([
      message({ id: 'a', createdAt: yesterday.toISOString() }),
      message({ id: 'b', createdAt: now.toISOString() }),
    ])
    // The separators carry the date as real text — hiding them from assistive
    // tech left a screen-reader user with an undifferentiated stream.
    expect(screen.getByText('Yesterday')).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('shows an empty state rather than a blank void in a new conversation', () => {
    renderList([])
    expect(screen.getByText('No messages yet')).toBeInTheDocument()
  })

  it('gives every message a machine-readable timestamp', () => {
    renderList([message()])
    expect(document.querySelector('time')).toHaveAttribute('dateTime', '2026-09-02T10:00:00.000Z')
  })

  it('shows an in-flight message as pending', () => {
    renderList([], [{ clientMessageId: 'c1', body: 'on its way', createdAt: '2026-09-02T10:00:00.000Z', failed: false }])
    expect(screen.getByText('on its way')).toBeInTheDocument()
    expect(screen.getByText('Sending…')).toBeInTheDocument()
  })

  /** A message that failed must stay visible with a way to retry, never vanish. */
  it('offers a retry for a failed message instead of discarding it', () => {
    renderList([], [{ clientMessageId: 'c1', body: 'did not send', createdAt: '2026-09-02T10:00:00.000Z', failed: true }])
    expect(screen.getByText('did not send')).toBeInTheDocument()
    expect(screen.getByText('Not sent')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('renders a skeleton while loading rather than an empty transcript', () => {
    render(
      <MessageList
        messages={[]}
        pending={[]}
        currentUserId={ME}
        conversationTitle="Bob"
        isSpace={false}
        isLoading
        hasOlder={false}
        isLoadingOlder={false}
        onLoadOlder={jest.fn()}
        onRetryPending={jest.fn()}
      />,
    )
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('offers to load history only when there is more of it', () => {
    const { rerender } = renderList([message()])
    expect(screen.queryByRole('button', { name: /earlier/i })).toBeNull()

    rerender(
      <MessageList
        messages={[message()]}
        pending={[]}
        currentUserId={ME}
        conversationTitle="Bob"
        isSpace={false}
        isLoading={false}
        hasOlder
        isLoadingOlder={false}
        onLoadOlder={jest.fn()}
        onRetryPending={jest.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /earlier/i })).toBeInTheDocument()
  })
  describe('turn grouping', () => {
    it('collapses consecutive messages from one person into a single turn', () => {
      renderList([
        message({ id: 'a', senderUserId: THEM, createdAt: '2026-09-02T10:00:00.000Z' }),
        message({ id: 'b', senderUserId: THEM, createdAt: '2026-09-02T10:01:00.000Z' }),
        message({ id: 'c', senderUserId: THEM, createdAt: '2026-09-02T10:02:00.000Z' }),
      ])
      // One author line for three messages: the name is stated once.
      expect(authorLineCount()).toBe(1)
      expect(screen.getAllByText('Bob')).toHaveLength(1)
    })

    it('starts a new turn once the messages are far enough apart', () => {
      renderList([
        message({ id: 'a', senderUserId: THEM, createdAt: '2026-09-02T10:00:00.000Z' }),
        // Six minutes later — past the five-minute window.
        message({ id: 'b', senderUserId: THEM, createdAt: '2026-09-02T10:06:00.000Z' }),
      ])
      expect(authorLineCount()).toBe(2)
    })

    it('starts a new turn when the sender changes', () => {
      renderList([
        message({ id: 'a', senderUserId: THEM, createdAt: '2026-09-02T10:00:00.000Z' }),
        message({ id: 'b', senderUserId: ME, createdAt: '2026-09-02T10:00:30.000Z' }),
      ])
      expect(authorLineCount()).toBe(2)
    })
  })

  describe('unread divider', () => {
    const older = message({ id: 'a', senderUserId: THEM, createdAt: '2026-09-02T10:00:00.000Z' })
    const newer = message({ id: 'b', senderUserId: THEM, createdAt: '2026-09-02T10:01:00.000Z' })

    it('marks the first message the reader had not seen', () => {
      renderList([older, newer], [], { unreadSince: '2026-09-02T10:00:30.000Z' })
      expect(screen.getByText('New')).toBeInTheDocument()
      // The divider splits the run, so the message under it re-states the author.
      expect(authorLineCount()).toBe(2)
    })

    it('treats a never-read conversation as entirely new', () => {
      renderList([older, newer], [], { unreadSince: null })
      expect(screen.getByText('New')).toBeInTheDocument()
    })

    it('stays hidden until the read cursor is known', () => {
      renderList([older, newer], [], { unreadSince: undefined })
      expect(screen.queryByText('New')).toBeNull()
    })

    it('never marks your own messages unread', () => {
      renderList(
        [message({ id: 'mine', senderUserId: ME, createdAt: '2026-09-02T10:05:00.000Z' })],
        [],
        { unreadSince: '2026-09-02T10:00:00.000Z' },
      )
      expect(screen.queryByText('New')).toBeNull()
    })
  })

  describe('message actions', () => {
    it('offers copy behind a per-message menu rather than a permanent control', () => {
      renderList([message({ body: 'the exact text' })])
      // The trigger exists for every message; the action itself only after it is
      // opened, which is what keeps the transcript free of per-message chrome.
      const trigger = screen.getByRole('button', { name: /open actions/i })
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
      expect(screen.queryByText('Copy message')).toBeNull()
    })

    it('copies the message body verbatim', async () => {
      const writeText = jest.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })
      renderList([message({ body: 'the exact text' })])

      fireEvent.click(screen.getByRole('button', { name: /open actions/i }))
      fireEvent.click(screen.getByText('Copy message'))

      expect(writeText).toHaveBeenCalledWith('the exact text')
    })
  })

  describe('sender differentiation', () => {
    const theirs = message({ id: 'a', senderUserId: THEM, createdAt: '2026-09-02T10:00:00.000Z' })
    const mine = message({ id: 'b', senderUserId: ME, createdAt: '2026-09-02T10:30:00.000Z' })

    it('puts your messages on one side and theirs on the other', () => {
      renderList([theirs, mine])
      const rows = [...document.querySelectorAll('li[class*="group/msg"]')]
      expect(rows).toHaveLength(2)
      // Side is the primary signal: theirs start-aligned, yours end-aligned.
      expect(rows[0].className).toContain('items-start')
      expect(rows[1].className).toContain('items-end')
    })

    it('shows an avatar only for the other person', () => {
      renderList([theirs, mine])
      const rows = [...document.querySelectorAll('li[class*="group/msg"]')]
      expect(rows[0].querySelector('[class*="rounded-full"]')).not.toBeNull()
      expect(rows[1].querySelector('[class*="rounded-full"]')).toBeNull()
    })

    it('still names you for a screen reader, since alignment is not announced', () => {
      renderList([mine])
      const you = screen.getByText('You')
      expect(you).toBeInTheDocument()
      // Hidden visually — the side already says it — but present in the tree.
      expect(you.className).toContain('sr-only')
    })

    it('keeps an unsent message on your side so it never jumps when it lands', () => {
      renderList([], [{ clientMessageId: 'c1', body: 'pending', createdAt: '2026-09-02T10:31:00.000Z', failed: false }])
      const row = document.querySelector('ol > li:last-of-type')
      expect(row?.className).toContain('items-end')
    })
  })

  /**
   * The receipt is derived, not stored: a message of yours is read once the other
   * person's cursor passes its `createdAt`. Delivery is the message's own
   * timestamp — the moment the server accepted it — because that is the only
   * delivery this system actually observes.
   */
  describe('read receipts', () => {
    const mine = (id: string, at: string) =>
      message({ id, senderUserId: ME, createdAt: at })

    it('reports delivery while the other person has not caught up', () => {
      renderList([mine('a', '2026-09-02T10:00:00.000Z')], [], {
        counterpartLastReadAt: '2026-09-02T09:00:00.000Z',
      })
      expect(screen.getByText(/^Delivered/)).toBeInTheDocument()
      expect(screen.queryByText(/^Read/)).toBeNull()
    })

    it('reports a read once their cursor passes the message', () => {
      renderList([mine('a', '2026-09-02T10:00:00.000Z')], [], {
        counterpartLastReadAt: '2026-09-02T10:05:00.000Z',
      })
      expect(screen.getByText(/^Read/)).toBeInTheDocument()
    })

    it('treats a never-opened conversation as delivered, not read', () => {
      renderList([mine('a', '2026-09-02T10:00:00.000Z')], [], { counterpartLastReadAt: null })
      expect(screen.getByText(/^Delivered/)).toBeInTheDocument()
    })

    it('marks only the newest message you sent, not every one', () => {
      renderList(
        [mine('a', '2026-09-02T10:00:00.000Z'), mine('b', '2026-09-02T10:01:00.000Z')],
        [],
        { counterpartLastReadAt: '2026-09-02T10:05:00.000Z' },
      )
      // Both are read, but repeating that on every line says nothing extra.
      expect(screen.getAllByText(/^Read/)).toHaveLength(1)
    })

    it("never puts a receipt on the other person's messages", () => {
      renderList([message({ id: 'a', senderUserId: THEM })], [], {
        counterpartLastReadAt: '2026-09-02T23:00:00.000Z',
      })
      expect(screen.queryByText(/^Read/)).toBeNull()
      expect(screen.queryByText(/^Delivered/)).toBeNull()
    })
  })

  /**
   * Where a conversation lands when you open it.
   *
   * Asserted as the scroll position the component drives the container to, not
   * as which DOM method it called — the outcome, not the mechanism.
   */
  describe('opening position', () => {
    const theirs = (id: string, at: string) => message({ id, senderUserId: THEM, createdAt: at })

    const props = (extra: Partial<React.ComponentProps<typeof MessageList>> = {}) => ({
      pending: [],
      currentUserId: ME,
      conversationTitle: 'Bob',
      isSpace: false,
      isLoading: false,
      hasOlder: false,
      isLoadingOlder: false,
      onLoadOlder: jest.fn(),
      onRetryPending: jest.fn(),
      ...extra,
    })

    const lastScroll = () => scrollCalls[scrollCalls.length - 1]

    it('lands all the way at the bottom when the conversation is read', () => {
      render(
        <MessageList
          messages={[theirs('a', '2026-09-02T10:00:00.000Z'), theirs('b', '2026-09-02T10:01:00.000Z')]}
          {...props({ unreadSince: '2026-09-02T23:00:00.000Z' })}
        />,
      )
      expect(screen.queryByText('New')).toBeNull()
      // The full scroll height, which the browser clamps to the true maximum —
      // not an approximation from aligning some marker element.
      expect(lastScroll()).toMatchObject({ top: SCROLL_HEIGHT, behavior: 'auto' })
    })

    /**
     * The path that was broken twice: React Query already holds the conversation,
     * so the messages are present on the very first render and the count never
     * transitions. Positioning must not depend on having watched it grow.
     */
    it('lands at the bottom even when the messages were already cached', () => {
      render(
        <MessageList
          messages={[theirs('a', '2026-09-02T10:00:00.000Z')]}
          {...props({ unreadSince: '2026-09-02T23:00:00.000Z' })}
        />,
      )
      expect(lastScroll()).toMatchObject({ top: SCROLL_HEIGHT })
    })

    it('lands on the first unread message when there is something new', () => {
      render(
        <MessageList
          messages={[theirs('a', '2026-09-02T10:00:00.000Z'), theirs('b', '2026-09-02T10:10:00.000Z')]}
          {...props({ unreadSince: '2026-09-02T10:05:00.000Z' })}
        />,
      )
      expect(screen.getByText('New')).toBeInTheDocument()
      // Not the bottom: it is placed relative to the divider instead.
      expect(lastScroll()!.top).not.toBe(SCROLL_HEIGHT)
      expect(lastScroll()).toMatchObject({ behavior: 'auto' })
    })

    it('lands at the bottom when nothing unread could be theirs', () => {
      render(<MessageList messages={[message({ id: 'a', senderUserId: ME })]} {...props({ unreadSince: null })} />)
      expect(screen.queryByText('New')).toBeNull()
      expect(lastScroll()).toMatchObject({ top: SCROLL_HEIGHT })
    })

    it('positions once and does not re-place on every later message', () => {
      const shared = props({ unreadSince: '2026-09-02T23:00:00.000Z' })
      const { rerender } = render(
        <MessageList messages={[theirs('a', '2026-09-02T10:00:00.000Z')]} {...shared} />,
      )
      scrollCalls = []
      rerender(
        <MessageList
          messages={[theirs('a', '2026-09-02T10:00:00.000Z'), theirs('b', '2026-09-02T10:01:00.000Z')]}
          {...shared}
        />,
      )
      // Staying at the bottom belongs to the resize observer, which is the only
      // thing that sees the row's final height. Re-placing from the count effect
      // aimed at a stale `scrollHeight` and stopped ~96px short.
      expect(scrollCalls).toHaveLength(0)
    })

    it('survives an environment without ResizeObserver', () => {
      // jsdom has none. The component must degrade to "positioned once", not throw.
      expect(() =>
        render(
          <MessageList
            messages={[theirs('a', '2026-09-02T10:00:00.000Z')]}
            {...props({ unreadSince: '2026-09-02T23:00:00.000Z' })}
          />,
        ),
      ).not.toThrow()
    })

    describe('staying at the bottom', () => {
      let fire: (() => void) | null = null

      beforeEach(() => {
        fire = null
        ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
          constructor(cb: () => void) {
            fire = cb
          }
          observe() {}
          disconnect() {}
        }
      })

      afterEach(() => {
        delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
      })

      it('re-pins when the content grows and the reader is at the bottom', () => {
        render(
          <MessageList
            messages={[theirs('a', '2026-09-02T10:00:00.000Z')]}
            {...props({ unreadSince: '2026-09-02T23:00:00.000Z' })}
          />,
        )
        const scroller = transcript()
        scroller.scrollTop = 0
        fire!()
        // Back to the true maximum, whatever the content settled at.
        expect(scroller.scrollTop).toBe(SCROLL_HEIGHT)
      })

      it('leaves a reader who scrolled up alone', () => {
        render(
          <MessageList
            messages={[theirs('a', '2026-09-02T10:00:00.000Z')]}
            {...props({ unreadSince: '2026-09-02T23:00:00.000Z' })}
          />,
        )
        const scroller = transcript()
        // Far from the bottom: a scroll event marks the reader as detached.
        scroller.scrollTop = 0
        fireEvent.scroll(scroller)
        fire!()
        expect(scroller.scrollTop).toBe(0)
      })
    })

    it('scrolls the transcript itself, never an ancestor', () => {
      render(
        <MessageList
          messages={[theirs('a', '2026-09-02T10:00:00.000Z')]}
          {...props({ unreadSince: '2026-09-02T23:00:00.000Z' })}
        />,
      )
      // `scrollIntoView` would have walked up to `main`, which is a scroll
      // container on viewport-locked pages.
      expect(transcript()).not.toBeNull()
      expect(scrollCalls.length).toBeGreaterThan(0)
    })
  })

  /**
   * The action bar belongs to the message, not to the row. Anchoring it to the
   * row's outer margin left it stranded far from a short reply; it now shares a
   * bubble-sized box with the bubble and sits above it.
   */
  describe('message action placement', () => {
    const bubbleOf = (li: Element) => li.querySelector('div[class*="rounded-2xl"]')!
    /** The positioner — the box that owns the anchor and the hit bridge. */
    const barOf = (li: Element) => li.querySelector('div[class*="bottom-full"]')!

    it('puts the bar in the same box as the bubble, not loose in the row', () => {
      renderList([message({ id: 'a', senderUserId: THEM })])
      const li = document.querySelector('li[class*="group/msg"]')!
      const bar = barOf(li)
      const bubble = bubbleOf(li)
      // Same parent, and that parent is the one sized to the bubble.
      expect(bar.parentElement).toBe(bubble.parentElement)
      expect(bar.parentElement!.className).toContain('relative')
      expect(bar.parentElement!.className).toContain('w-fit')
    })

    /**
     * The reachability contract, and the reason the bar is two elements rather
     * than one.
     *
     * A bar parked at a fixed offset above the bubble leaves a band of pixels
     * between the two that belongs to the message ABOVE. Moving the pointer up
     * to press the button crosses that band, the row loses `:hover`, and the bar
     * disappears mid-reach — measured in the browser, the two pixels below the
     * old `-top-10` bar hit-tested to the transcript list rather than to the row.
     *
     * Anchoring the box's bottom edge to the bubble (`bottom-full`), lapping it
     * by a pixel (`-mb-px`) and putting the visual offset in padding instead of
     * in the anchor makes the box run continuously from the chrome into the
     * message, so the whole path belongs to the row that owns the bar.
     */
    it('bridges the gap to the bubble instead of floating clear of it', () => {
      renderList([message({ id: 'a', senderUserId: THEM })])
      const bar = barOf(document.querySelector('li[class*="group/msg"]')!)
      // Anchored to the bubble's top edge, not parked at a fixed offset.
      expect(bar.className).toContain('bottom-full')
      expect(bar.className).not.toMatch(/(^|\s)-top-\d/)
      // The gap is padding inside the hit box, and the box laps the bubble so no
      // sub-pixel seam can open between them.
      expect(bar.className).toMatch(/(^|\s)pb-/)
      expect(bar.className).toContain('-mb-px')
    })

    /** The chrome is the inner element, so the bridge stays invisible. */
    it('keeps the visible chrome separate from the hit bridge', () => {
      renderList([message({ id: 'a', senderUserId: THEM })])
      const bar = barOf(document.querySelector('li[class*="group/msg"]')!)
      const chrome = bar.firstElementChild!
      expect(chrome.className).toContain('rounded-lg')
      expect(chrome.className).toContain('bg-surface')
      // The padding that makes the bridge is on the positioner, never on the
      // chrome — putting it there would inflate the visible pill instead.
      expect(chrome.className).not.toMatch(/(^|\s)pb-1\.5/)
    })

    /**
     * The bar is wider than a short bubble, so which edge it is pinned to decides
     * which way it grows. It has to grow *inwards*, away from the wall the bubble
     * is already against — pinning the near edge instead sent an 83px bar 20px
     * past the scroller on a three-character message, and because the transcript's
     * `overflow-y-auto` promotes `overflow-x` to `auto`, that produced a
     * horizontal scrollbar across the whole conversation.
     */
    it('opens the bar inwards, away from the wall its bubble is against', () => {
      renderList([
        message({ id: 'a', senderUserId: THEM, createdAt: '2026-09-02T10:00:00.000Z' }),
        message({ id: 'b', senderUserId: ME, createdAt: '2026-09-02T10:30:00.000Z' }),
      ])
      const rows = [...document.querySelectorAll('li[class*="group/msg"]')]
      // Theirs hugs the left wall: pin its left edge so the bar grows right.
      expect(barOf(rows[0]!).className).toContain('left-0')
      expect(barOf(rows[0]!).className).not.toContain('right-0')
      // Yours hugs the right wall: pin its right edge so the bar grows left.
      expect(barOf(rows[1]!).className).toContain('right-0')
      expect(barOf(rows[1]!).className).not.toContain('left-0')
    })
  })

  /**
   * Holding a scrolled-up reader in place.
   *
   * jsdom has no layout, so rows are given a faithful synthetic geometry: each is
   * ROW_H tall, stacked by DOM order, offset by the current scroll position. That
   * makes a drop or a prepend move the surviving rows on its own — exactly as the
   * browser would — rather than the test hand-waving a shift. What is asserted is
   * the compensation the component applies.
   */
  describe('reading anchor', () => {
    const ROW_H = 40

    const theirs = (id: string, at: string) => message({ id, senderUserId: THEM, createdAt: at })
    const props = {
      pending: [],
      currentUserId: ME,
      conversationTitle: 'Bob',
      isSpace: false,
      isLoading: false,
      hasOlder: false,
      isLoadingOlder: false,
      onLoadOlder: jest.fn(),
      onRetryPending: jest.fn(),
      unreadSince: '2026-09-02T23:00:00.000Z',
    }

    beforeEach(() => {
      Element.prototype.getBoundingClientRect = function rect(this: Element) {
        const id = (this as HTMLElement).dataset?.messageId
        if (id === undefined) {
          // The scroll container: the frame everything is measured against.
          return { top: 0, bottom: CLIENT_HEIGHT, height: CLIENT_HEIGHT, left: 0, right: 0, width: 0 } as DOMRect
        }
        const index = [...document.querySelectorAll('[data-message-id]')].indexOf(this)
        const top = index * ROW_H - scrollTopValue
        return { top, bottom: top + ROW_H, height: ROW_H, left: 0, right: 0, width: 0 } as DOMRect
      } as typeof Element.prototype.getBoundingClientRect
    })

    const from = (ids: string[]) =>
      ids.map((id, i) => theirs(id, `2026-09-02T10:${String(i).padStart(2, '0')}:00.000Z`))

    /** Scrolled far enough that a middle row is the one at the top of the view. */
    const scrollAwayFromBottom = (scroller: HTMLElement) => {
      scrollTopValue = 100
      fireEvent.scroll(scroller)
    }

    it('holds the reader in place when the window drops a row off the top', () => {
      const { rerender } = render(<MessageList messages={from(['a', 'b', 'c', 'd'])} {...props} />)
      const scroller = transcript()
      scrollAwayFromBottom(scroller)

      // What an arriving message does to a full window: oldest out, newest in.
      // Every surviving row's index drops by one, so it rises by ROW_H.
      rerender(<MessageList messages={from(['b', 'c', 'd', 'e'])} {...props} />)

      // Compensated by exactly the row that left.
      expect(scroller.scrollTop).toBe(100 - ROW_H)
    })

    it('holds the reader in place when older history is prepended', () => {
      // Enough rows that one is genuinely on screen at this scroll position;
      // with fewer, every row is above the fold and there is nothing to anchor.
      const { rerender } = render(<MessageList messages={from(['c', 'd', 'e', 'f'])} {...props} />)
      const scroller = transcript()
      scrollAwayFromBottom(scroller)

      // Two rows inserted above: the anchored row's index rises by two.
      rerender(<MessageList messages={from(['a', 'b', 'c', 'd', 'e', 'f'])} {...props} />)

      expect(scroller.scrollTop).toBe(100 + 2 * ROW_H)
    })

    it('leaves the position alone when the anchored message is gone entirely', () => {
      const { rerender } = render(<MessageList messages={from(['a', 'b', 'c', 'd'])} {...props} />)
      const scroller = transcript()
      scrollAwayFromBottom(scroller)

      // Nothing left to hold on to — guessing would be worse than not moving.
      rerender(<MessageList messages={from(['w', 'x', 'y', 'z'])} {...props} />)

      expect(scroller.scrollTop).toBe(100)
    })

    it('stands aside when the reader is at the bottom, where the pin governs', () => {
      const { rerender } = render(<MessageList messages={from(['a', 'b', 'c', 'd'])} {...props} />)
      const scroller = transcript()

      // Scroll away first, so an anchor is genuinely recorded...
      scrollAwayFromBottom(scroller)
      // ...then return to the bottom. The anchor is now stale, and only the
      // stuck-to-bottom guard stops it dragging the reader back up.
      scrollTopValue = SCROLL_HEIGHT - CLIENT_HEIGHT
      fireEvent.scroll(scroller)

      rerender(<MessageList messages={from(['b', 'c', 'd', 'e'])} {...props} />)

      expect(scroller.scrollTop).toBe(SCROLL_HEIGHT - CLIENT_HEIGHT)
    })
  })
})

/**
 * Spaces and replies.
 *
 * These assert the behaviour that differs from a direct conversation, and the
 * two rules that keep a reply reference from becoming a dead end: a quote is a
 * button only when its original is on screen, and a deleted original degrades to
 * a sentence rather than an empty line.
 */
describe('spaces', () => {
  it('labels each incoming turn with its own author', () => {
    renderList(
      [
        message({ id: 'm1', senderUserId: 'user-a', senderName: 'Alice', body: 'first' }),
        message({
          id: 'm2',
          senderUserId: 'user-b',
          senderName: 'Bob',
          body: 'second',
          createdAt: '2026-09-02T10:01:00.000Z',
        }),
      ],
      [],
      { isSpace: true, conversationTitle: 'Project Alpha' },
    )
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('Bob')).toBeTruthy()
  })

  it('renders a membership event as a sentence, not as a message bubble', () => {
    renderList(
      [
        message({
          id: 'sys1',
          kind: 'system',
          systemEvent: 'member_added',
          senderUserId: 'user-a',
          senderName: 'Alice',
          systemTargetUserId: 'user-b',
          systemTargetName: 'Bob',
          body: '',
        }),
      ],
      [],
      { isSpace: true },
    )
    expect(screen.getByText(/Alice added Bob/)).toBeTruthy()
  })

  it('does not let a membership event split one person\'s turn in two', () => {
    renderList(
      [
        message({ id: 'm1', senderUserId: 'user-a', senderName: 'Alice', body: 'first' }),
        message({
          id: 'sys1',
          kind: 'system',
          systemEvent: 'member_added',
          senderUserId: 'user-a',
          senderName: 'Alice',
          systemTargetName: 'Bob',
          body: '',
          createdAt: '2026-09-02T10:00:30.000Z',
        }),
        message({
          id: 'm2',
          senderUserId: 'user-a',
          senderName: 'Alice',
          body: 'second',
          createdAt: '2026-09-02T10:01:00.000Z',
        }),
      ],
      [],
      { isSpace: true },
    )
    // Two author lines: the turn restarts after the system row rather than
    // leaving the second bubble headerless under a row that is not a message.
    expect(authorLineCount()).toBe(2)
  })

  it('prints one date separator even when a system row opens the day', () => {
    renderList(
      [
        message({
          id: 'sys1',
          kind: 'system',
          systemEvent: 'member_added',
          senderName: 'Alice',
          systemTargetName: 'Bob',
          body: '',
          createdAt: '2026-09-02T09:00:00.000Z',
        }),
        message({ id: 'm1', senderName: 'Alice', body: 'hello', createdAt: '2026-09-02T10:00:00.000Z' }),
      ],
      [],
      { isSpace: true },
    )
    expect(document.querySelectorAll('li[data-row="separator"]')).toHaveLength(1)
  })
})

/**
 * The receipt marks the newest message YOU SENT. A membership event carries your
 * id as its actor, so without a `kind` filter, adding someone to a space made a
 * system row the newest thing you had "sent" — and system rows render as a
 * centred line with no receipt, so the receipt silently vanished from the whole
 * conversation until you typed again.
 */
describe('read receipt vs system events', () => {
  it('keeps the receipt on the newest message you actually sent', () => {
    renderList(
      [
        message({ id: 'mine', senderUserId: ME, senderName: 'Me', body: 'the last thing I typed' }),
        message({
          id: 'sys',
          kind: 'system',
          systemEvent: 'member_added',
          senderUserId: ME,
          senderName: 'Me',
          systemTargetName: 'Bob',
          body: '',
          createdAt: '2026-09-02T10:05:00.000Z',
        }),
      ],
      [],
      { isSpace: true, counterpartLastReadAt: null },
    )
    expect(screen.getByText(/Delivered/)).toBeTruthy()
  })
})

describe('reply references', () => {
  const original = message({ id: 'orig', senderUserId: THEM, senderName: 'Bob', body: 'the question' })

  it('quotes the original above the reply body', () => {
    renderList([
      original,
      message({
        id: 'reply',
        senderUserId: ME,
        senderName: 'Me',
        body: 'the answer',
        createdAt: '2026-09-02T10:05:00.000Z',
        replyTo: { id: 'orig', senderUserId: THEM, senderName: 'Bob', body: 'the question', deleted: false },
      }),
    ])
    expect(screen.getAllByText('the question').length).toBeGreaterThan(0)
    expect(screen.getByText('the answer')).toBeTruthy()
  })

  it('makes the quote a button when the original is loaded', () => {
    renderList([
      original,
      message({
        id: 'reply',
        senderUserId: ME,
        body: 'the answer',
        createdAt: '2026-09-02T10:05:00.000Z',
        replyTo: { id: 'orig', senderUserId: THEM, senderName: 'Bob', body: 'the question', deleted: false },
      }),
    ])
    const quote = screen.getAllByText('Bob').find((node) => node.closest('button'))
    expect(quote).toBeTruthy()
  })

  it('leaves the quote inert when the original is not on screen', () => {
    // No `orig` message in the list — it is older than the loaded window.
    renderList([
      message({
        id: 'reply',
        senderUserId: ME,
        body: 'the answer',
        replyTo: { id: 'orig', senderUserId: THEM, senderName: 'Bob', body: 'the question', deleted: false },
      }),
    ])
    const quote = screen.getAllByText('Bob').find((node) => node.closest('button'))
    expect(quote).toBeUndefined()
  })

  /**
   * Three RENDERED lines is the bound, so it is enforced in CSS rather than by
   * cutting the string server-side: only the browser knows how many characters
   * three lines holds at the reader's pane width. `truncate` would defeat it by
   * pinning the text to a single line, so the quote must not carry both.
   */
  it('clamps a long quote to three lines rather than one', () => {
    const long = 'x'.repeat(280)
    renderList([
      message({
        id: 'reply',
        senderUserId: ME,
        body: 'short answer',
        replyTo: { id: 'orig', senderUserId: THEM, senderName: 'Bob', body: long, deleted: false },
      }),
    ])
    const quoted = screen.getByText(long)
    expect(quoted.className).toContain('line-clamp-3')
    expect(quoted.className).not.toContain('truncate')
    // Wrapping is what gives the clamp lines to count.
    expect(quoted.className).toContain('whitespace-pre-wrap')
  })

  it('says so rather than rendering a blank quote for a deleted original', () => {
    renderList([
      message({
        id: 'reply',
        senderUserId: ME,
        body: 'the answer',
        replyTo: { id: 'orig', senderUserId: THEM, senderName: 'Bob', body: '', deleted: true },
      }),
    ])
    expect(screen.getByText('Original message unavailable')).toBeTruthy()
  })

  it('offers Reply only when the viewer can send', () => {
    const onReply = jest.fn()
    const { unmount } = renderList([original], [], { onReply })
    fireEvent.click(screen.getAllByRole('button', { name: /actions/i })[0]!)
    expect(screen.getByText('Reply')).toBeTruthy()
    unmount()

    renderList([original], [], { onReply: undefined })
    fireEvent.click(screen.getAllByRole('button', { name: /actions/i })[0]!)
    expect(screen.queryByText('Reply')).toBeNull()
  })

  it('hands the reply target back with the author and body', () => {
    const onReply = jest.fn()
    renderList([original], [], { onReply })
    fireEvent.click(screen.getAllByRole('button', { name: /actions/i })[0]!)
    fireEvent.click(screen.getByText('Reply'))
    expect(onReply).toHaveBeenCalledWith({
      messageId: 'orig',
      authorName: 'Bob',
      body: 'the question',
    })
  })
})
