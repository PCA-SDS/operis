/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { MessageList } from '../components/MessageList'
import type { ChatMessageDto } from '../data/types'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : String(_key)),
  useLocale: () => 'en',
}))

const ME = 'user-me'
const THEM = 'user-them'

function message(overrides: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    id: 'm1',
    conversationId: 'conv-1',
    senderUserId: THEM,
    body: 'hello',
    createdAt: '2026-09-02T10:00:00.000Z',
    clientMessageId: null,
    ...overrides,
  }
}

function renderList(messages: ChatMessageDto[], pending: React.ComponentProps<typeof MessageList>['pending'] = []) {
  return render(
    <MessageList
      messages={messages}
      pending={pending}
      currentUserId={ME}
      counterpartName="Bob"
      isLoading={false}
      hasOlder={false}
      isLoadingOlder={false}
      onLoadOlder={jest.fn()}
      onRetryPending={jest.fn()}
    />,
  )
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
        counterpartName="Bob"
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
        counterpartName="Bob"
        isLoading={false}
        hasOlder
        isLoadingOlder={false}
        onLoadOlder={jest.fn()}
        onRetryPending={jest.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /earlier/i })).toBeInTheDocument()
  })
})
