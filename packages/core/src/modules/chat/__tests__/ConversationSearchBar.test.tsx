/**
 * @jest-environment jsdom
 */

/**
 * The find bar's navigation contract.
 *
 * The rules it encodes are the ones every chat client shares and a browser find
 * bar does not: typing reports a count and moves nothing, navigating is
 * explicit, and landing never takes the caret out of the field someone is still
 * typing into. Each is easy to undo by accident, so each is pinned here.
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ConversationSearchBar } from '../components/ConversationSearchBar'
import type { ChatSearchHitDto } from '../data/types'

const format = (template: string, params?: Record<string, unknown>) =>
  params
    ? template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''))
    : template

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: unknown, params?: Record<string, unknown>) =>
    format(typeof fallback === 'string' ? fallback : String(key), params),
  useLocale: () => 'en',
}))

jest.mock('../components/plurals', () => ({
  useTCount: () => (_key: string, count: number, fallback: string) =>
    fallback.replace('{count}', String(count)),
}))

const searchResult = {
  results: [] as ChatSearchHitDto[],
  total: 0,
  totalIsCapped: false,
  activeQuery: '',
  isSearching: false,
  hasMore: false,
  loadMore: jest.fn(),
}

jest.mock('../components/hooks', () => ({
  useChatSearch: () => searchResult,
}))

function hit(id: string): ChatSearchHitDto {
  return {
    messageId: id,
    conversationId: 'c1',
    conversationTitle: null,
    conversationKind: 'direct',
    senderUserId: 'u1',
    senderName: 'Bo',
    snippet: id,
    highlights: [],
    truncatedStart: false,
    truncatedEnd: false,
    createdAt: '2026-09-06T00:00:00.000Z',
  }
}

function setResults(ids: string[], extra: Partial<typeof searchResult> = {}) {
  Object.assign(searchResult, {
    results: ids.map(hit),
    total: ids.length,
    totalIsCapped: false,
    activeQuery: 'budget',
    isSearching: false,
    hasMore: false,
    loadMore: jest.fn(),
    ...extra,
  })
}

function renderBar(overrides: Partial<React.ComponentProps<typeof ConversationSearchBar>> = {}) {
  const onJumpToMessage = jest.fn()
  const onSearchStateChange = jest.fn()
  const onClose = jest.fn()
  const view = render(
    <ConversationSearchBar
      conversationId="c1"
      onJumpToMessage={onJumpToMessage}
      onSearchStateChange={onSearchStateChange}
      onClose={onClose}
      {...overrides}
    />,
  )
  return { ...view, onJumpToMessage, onSearchStateChange, onClose }
}

const next = () => screen.getByLabelText('Next match')
const previous = () => screen.getByLabelText('Previous match')
const count = () => screen.getByRole('status').textContent

beforeEach(() => {
  Object.assign(searchResult, {
    results: [],
    total: 0,
    totalIsCapped: false,
    activeQuery: '',
    isSearching: false,
    hasMore: false,
    loadMore: jest.fn(),
  })
})

describe('ConversationSearchBar', () => {
  it('reports a count and moves nothing until asked', () => {
    // The complaint this encodes: a transcript that travels on every keystroke
    // takes the conversation away from the person reading it.
    setResults(['a', 'b', 'c'])
    const { onJumpToMessage } = renderBar()

    expect(count()).toBe('3 matches')
    expect(onJumpToMessage).not.toHaveBeenCalled()
  })

  it('lands on the first match on the first press forward', () => {
    setResults(['a', 'b', 'c'])
    const { onJumpToMessage } = renderBar()

    fireEvent.click(next())
    expect(onJumpToMessage).toHaveBeenCalledWith('a', expect.anything())
    expect(count()).toBe('1 of 3')
  })

  it('lands on the last match on the first press backward', () => {
    // Otherwise "previous" from a standing start quietly means the same thing
    // as "next".
    setResults(['a', 'b', 'c'])
    const { onJumpToMessage } = renderBar()

    fireEvent.click(previous())
    expect(onJumpToMessage).toHaveBeenCalledWith('c', expect.anything())
    expect(count()).toBe('3 of 3')
  })

  it('never takes focus or flashes the row', () => {
    // Both would answer a question the marked words in the message already
    // answer — and taking focus empties the field mid-word.
    setResults(['a', 'b'])
    const { onJumpToMessage } = renderBar()

    fireEvent.click(next())
    expect(onJumpToMessage).toHaveBeenCalledWith('a', { focus: false, flash: false })
  })

  it('wraps in both directions once navigating', () => {
    setResults(['a', 'b'])
    renderBar()

    fireEvent.click(next())
    expect(count()).toBe('1 of 2')
    fireEvent.click(next())
    expect(count()).toBe('2 of 2')
    fireEvent.click(next())
    expect(count()).toBe('1 of 2')
    fireEvent.click(previous())
    expect(count()).toBe('2 of 2')
  })

  it('steps with Enter and back with Shift+Enter, the convention people already have', () => {
    setResults(['a', 'b', 'c'])
    renderBar()
    const field = screen.getByPlaceholderText('Search this conversation')

    fireEvent.keyDown(field, { key: 'Enter' })
    expect(count()).toBe('1 of 3')
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(count()).toBe('2 of 3')
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
    expect(count()).toBe('1 of 3')
  })

  it('closes on Escape', () => {
    setResults(['a'])
    const { onClose } = renderBar()

    fireEvent.keyDown(screen.getByPlaceholderText('Search this conversation'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('reaches a lone match every time it is asked, not just once', () => {
    // Stepping wraps back to the same index, and the "already there" guard used
    // to read that as nothing to do — so a single match was reachable once and
    // then never again.
    setResults(['only'])
    const { onJumpToMessage } = renderBar()

    fireEvent.click(next())
    fireEvent.click(next())
    expect(onJumpToMessage).toHaveBeenCalledTimes(2)
  })

  it('fetches the next page rather than wrapping early', () => {
    // The count spans every match, not just the loaded page, so wrapping at the
    // end of the page would strand the reader inside a total it advertised.
    const loadMore = jest.fn()
    setResults(['a', 'b'], { hasMore: true, total: 40, loadMore })
    renderBar()

    fireEvent.click(next())
    fireEvent.click(next())
    fireEvent.click(next())
    expect(loadMore).toHaveBeenCalled()
  })

  it('reports a capped total as a floor, not as an exact number', () => {
    setResults(['a', 'b'], { total: 500, totalIsCapped: true })
    renderBar()
    expect(count()).toBe('500+ matches')
  })

  it('tells the transcript what to mark, and clears it on the way out', () => {
    setResults(['a', 'b'])
    const { onSearchStateChange, unmount } = renderBar()

    expect(onSearchStateChange).toHaveBeenCalledWith({
      query: 'budget',
      currentMessageId: null,
    })

    fireEvent.click(next())
    expect(onSearchStateChange).toHaveBeenLastCalledWith({
      query: 'budget',
      currentMessageId: 'a',
    })

    // Leaving the marks behind would leave the transcript wearing the answer to
    // a question nobody is asking any more.
    unmount()
    expect(onSearchStateChange).toHaveBeenLastCalledWith({ query: '', currentMessageId: null })
  })

  it('does nothing when there is nothing to step through', () => {
    setResults([], { activeQuery: 'budget' })
    const { onJumpToMessage } = renderBar()

    expect(next()).toBeDisabled()
    expect(previous()).toBeDisabled()
    fireEvent.click(next())
    expect(onJumpToMessage).not.toHaveBeenCalled()
  })
})
