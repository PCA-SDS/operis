/**
 * @jest-environment jsdom
 */

/**
 * How the topbar panel names an unread conversation.
 *
 * By the title the server resolves for both kinds, the one the rail and the
 * header render. A space has no counterpart, so a row named from
 * `counterpart.name` called every unread space "Former colleague".
 */
import * as React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ChatUnreadIcon } from '../components/ChatUnreadIcon'
import type { ChatConversationDto } from '../data/types'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
  useLocale: () => 'en',
}))

jest.mock('../components/plurals', () => ({
  useTCount: () => (_key: string, count: number, fallback: string) =>
    fallback.replace('{count}', String(count)),
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend',
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const listResult = {
  conversations: [] as ChatConversationDto[],
  isLoading: false,
  error: null,
  retry: jest.fn(),
}

jest.mock('../components/hooks', () => ({
  useChatLiveRefresh: () => undefined,
  useChatUnreadCount: () => ({
    unreadCount: listResult.conversations.reduce((sum, item) => sum + item.unreadCount, 0),
  }),
  useConversations: () => listResult,
  useMarkAllRead: () => ({ isPending: false, mutate: jest.fn() }),
}))

function conversation(overrides: Partial<ChatConversationDto>): ChatConversationDto {
  return {
    id: 'direct-1',
    kind: 'direct',
    title: 'Ada Lovelace',
    memberCount: 0,
    viewerRole: 'member',
    counterpart: { id: 'user-2', name: 'Ada Lovelace', email: 'ada@example.com' },
    lastMessageAt: '2026-09-28T09:30:00.000Z',
    lastMessagePreview: 'Can you check the numbers?',
    lastMessageSenderUserId: 'user-2',
    unreadCount: 1,
    hasUnreadMention: false,
    pinnedCount: 0,
    muted: false,
    lastReadAt: null,
    counterpartLastReadAt: null,
    ...overrides,
  }
}

const direct = conversation({})

const space = conversation({
  id: 'space-1',
  kind: 'space',
  title: 'Finance Team',
  memberCount: 8,
  viewerRole: 'owner',
  counterpart: null,
  lastMessagePreview: 'Budget is up',
  lastMessageSenderUserId: 'user-3',
  unreadCount: 2,
})

async function openPanel(conversations: ChatConversationDto[]) {
  listResult.conversations = conversations
  render(<ChatUnreadIcon />)
  fireEvent.click(screen.getByRole('button', { name: /unread chat messages/ }))
  await screen.findByRole('list')
}

function rowFor(conversationId: string): HTMLElement {
  const row = screen
    .getAllByRole('link')
    .find((link) => link.getAttribute('href') === `/backend/chat/${conversationId}`)
  if (!row) throw new Error(`[internal] no row links to ${conversationId}`)
  return row
}

beforeEach(() => {
  listResult.conversations = []
})

describe('unread conversation rows', () => {
  it('names a space by its own title', async () => {
    await openPanel([space])
    const row = rowFor('space-1')
    expect(within(row).getByText('Finance Team')).toBeInTheDocument()
    expect(within(row).queryByText('Former colleague')).toBeNull()
  })

  it('names a direct by the other person', async () => {
    await openPanel([direct])
    expect(within(rowFor('direct-1')).getByText('Ada Lovelace')).toBeInTheDocument()
  })

  it('names each row correctly when both kinds are unread at once', async () => {
    await openPanel([space, direct])
    expect(within(rowFor('space-1')).getByText('Finance Team')).toBeInTheDocument()
    expect(within(rowFor('direct-1')).getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.queryByText('Former colleague')).toBeNull()
  })

  it('gives a space the group glyph and a direct its initials, as the rail does', async () => {
    await openPanel([space, direct])
    const spaceAvatar = within(rowFor('space-1')).getByRole('img', { name: 'Finance Team' })
    expect(spaceAvatar.querySelector('svg')).not.toBeNull()
    expect(spaceAvatar).not.toHaveTextContent('FT')
    const directAvatar = within(rowFor('direct-1')).getByRole('img', { name: 'Ada Lovelace' })
    expect(directAvatar.querySelector('svg')).toBeNull()
    expect(directAvatar).toHaveTextContent('AL')
  })

  it('keeps the former-colleague label for a row that arrives without a title', async () => {
    await openPanel([conversation({ id: 'direct-2', title: '', counterpart: null })])
    expect(within(rowFor('direct-2')).getByText('Former colleague')).toBeInTheDocument()
  })
})
