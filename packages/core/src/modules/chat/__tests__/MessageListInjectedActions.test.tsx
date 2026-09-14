/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ChatMessageDto } from '../data/types'
import { MessageList } from '../components/MessageList'

const injectedAction = { id: 'chat_tasks.message.create-task', label: 'Create task', onSelect: jest.fn() }
let spotClaimed = true
let injectedActions: unknown[] = [injectedAction]

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT:
    () =>
    (key: string, fallback?: string, params?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? '')),
  useLocale: () => 'en',
}))
jest.mock('../components/injection', () => ({
  useChatSpotClaimed: () => spotClaimed,
  useChatInjectedActions: () => injectedActions,
}))
const injectionSpot = jest.fn(() => null)
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: (props: unknown) => injectionSpot(props as never),
}))

/**
 * jsdom implements no layout and no scrolling, and `MessageList` scrolls itself to the
 * bottom on mount. The same fake geometry `MessageList.test.tsx` installs, for the same
 * reason: without it the component throws before a single assertion runs.
 */
const SCROLL_HEIGHT = 2000
const CLIENT_HEIGHT = 500
let scrollTopValue = 0

beforeAll(() => {
  Element.prototype.scrollTo = function scrollTo(this: Element, options?: unknown) {
    const call = options as { top: number }
    scrollTopValue = Math.max(0, Math.min(call?.top ?? 0, SCROLL_HEIGHT - CLIENT_HEIGHT))
  } as typeof Element.prototype.scrollTo
  Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get: () => SCROLL_HEIGHT })
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => CLIENT_HEIGHT })
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get: () => scrollTopValue,
    set: (next: number) => {
      scrollTopValue = next
    },
  })
})

const CONVERSATION = '33333333-3333-4333-8333-333333333333'
const ME = '55555555-5555-4555-8555-555555555555'
const THEM = '66666666-6666-4666-8666-666666666666'

function message(overrides: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    conversationId: CONVERSATION,
    senderUserId: THEM,
    senderName: 'Amir Haddad',
    kind: 'user',
    body: 'The client is unhappy about the price',
    createdAt: '2026-09-14T10:00:00.000Z',
    editedAt: null,
    clientMessageId: null,
    replyTo: null,
    systemEvent: null,
    systemTargetUserId: null,
    systemTargetName: null,
    reactions: [],
    mentionNames: {},
    mentionsEveryone: false,
    pinned: false,
    attachments: [],
    ...overrides,
  }
}

function renderList(messages: ChatMessageDto[]) {
  return render(
    <MessageList
      messages={messages}
      pending={[]}
      currentUserId={ME}
      conversationTitle="Amir Haddad"
      isSpace={false}
      onReply={jest.fn()}
    />,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  spotClaimed = true
  injectedActions = [injectedAction]
})

/**
 * These live here rather than in a browser test on purpose.
 *
 * `RowActions` closes its portalled menu 150ms after the pointer leaves the trigger, so
 * driving it from Playwright is a hit-test against an element that is dismissing itself.
 * What the menu CONTAINS, and what it hands the handler, is a question about this
 * component — chat's own suite makes the same call for its pin action (TC-CHAT-008).
 */
describe('a message action contributed by another module', () => {
  it('appears in the overflow menu alongside the module’s own entries', () => {
    renderList([message()])
    fireEvent.click(screen.getByRole('button', { name: /open actions/i }))
    expect(screen.getByRole('menuitem', { name: 'Create task' })).toBeTruthy()
    // The built-in entries are still there — the contribution adds, never replaces.
    expect(screen.getByRole('menuitem', { name: /reply/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /copy message/i })).toBeTruthy()
  })

  it('hands the handler the message it was opened on, not just its body', () => {
    // The whole reason these are row actions rather than menu items: a module acting on
    // "this message" needs the row, and a menu item receives nothing.
    renderList([message()])
    fireEvent.click(screen.getByRole('button', { name: /open actions/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create task' }))

    expect(injectedAction.onSelect).toHaveBeenCalledTimes(1)
    const [row, context] = injectedAction.onSelect.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ]
    expect(row).toMatchObject({
      conversationId: CONVERSATION,
      messageId: '11111111-1111-4111-8111-111111111111',
      senderUserId: THEM,
      senderName: 'Amir Haddad',
      body: 'The client is unhappy about the price',
      mine: false,
    })
    expect(context).toMatchObject({ conversationId: CONVERSATION, isSpace: false })
  })

  it('adds nothing when no module has claimed the spot', () => {
    injectedActions = []
    renderList([message()])
    fireEvent.click(screen.getByRole('button', { name: /open actions/i }))
    expect(screen.queryByRole('menuitem', { name: 'Create task' })).toBeNull()
    // And the menu is otherwise untouched, so chat behaves exactly as it did before.
    expect(screen.getByRole('menuitem', { name: /reply/i })).toBeTruthy()
  })
})

describe('a card row in the transcript', () => {
  const card = () =>
    message({
      id: '22222222-2222-4222-8222-222222222222',
      kind: 'system',
      systemEvent: 'card',
      // A card row stores no text at all — which is what keeps another module's data out
      // of chat's search document, previews and outbound transport.
      body: '',
    })

  it('renders the owning module’s spot rather than any text of its own', () => {
    renderList([card()])
    expect(injectionSpot).toHaveBeenCalled()
    const props = injectionSpot.mock.calls[0]![0] as { spotId: string; context: Record<string, unknown> }
    expect(props.spotId).toBe('chat:message:card')
    expect(props.context).toMatchObject({
      conversationId: CONVERSATION,
      messageId: '22222222-2222-4222-8222-222222222222',
      mine: false,
    })
  })

  it('says the card cannot be shown when nothing claims the spot', () => {
    // Unclaimed, `InjectionSpot` renders nothing — which for a row already in the
    // transcript is an unexplained gap rather than a degraded state. The fallback is what
    // makes a card whose module was disabled read as missing.
    spotClaimed = false
    renderList([card()])
    expect(screen.getByText(/cannot be shown here/i)).toBeTruthy()
    expect(injectionSpot).not.toHaveBeenCalled()
  })

  it('gives a card row no overflow menu, because there is nothing of chat’s to act on', () => {
    renderList([card()])
    expect(screen.queryByRole('button', { name: /open actions/i })).toBeNull()
  })
})
