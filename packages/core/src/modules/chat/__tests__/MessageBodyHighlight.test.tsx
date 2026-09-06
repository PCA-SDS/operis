/**
 * @jest-environment jsdom
 */

/**
 * Marking the searched words inside a message.
 *
 * The transcript renders messages the search response never mentioned — the
 * ones between the matches — so the marks are computed here from the query's
 * terms rather than served as ranges. These tests pin that the transcript and
 * the results list agree about what counts as a match, and that highlighting
 * never becomes a way to get markup into a message body.
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { MessageBody } from '../components/MessageBody'
import { highlightPlan, parseSearchQuery } from '../lib/searchQuery'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: unknown) =>
    typeof fallback === 'string' ? fallback : String(_key),
}))

const planFor = (query: string) => highlightPlan(parseSearchQuery(query))

function renderBody(body: string, query?: string, active = false) {
  return render(
    <MessageBody
      body={body}
      mentionNames={{}}
      currentUserId="me"
      highlight={query ? planFor(query) : undefined}
      highlightActive={active}
    />,
  )
}

describe('MessageBody search highlighting', () => {
  it('marks the searched words inside the text', () => {
    const { container } = renderBody('the quarterly budget review', 'budget')
    const marks = [...container.querySelectorAll('mark')]
    expect(marks.map((mark) => mark.textContent)).toEqual(['budget'])
  })

  it('marks accented text from an accentless query', () => {
    // The whole point of folding: someone types what their keyboard makes easy
    // and the message keeps the diacritics its author wrote.
    const { container } = renderBody('Báo cáo tài chính', 'bao cao')
    expect([...container.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
      'Báo',
      'cáo',
    ])
  })

  it('leaves the message alone when nothing is being searched', () => {
    const { container } = renderBody('the quarterly budget review')
    expect(container.querySelectorAll('mark')).toHaveLength(0)
    expect(container.textContent).toBe('the quarterly budget review')
  })

  it('marks the current match more strongly than the rest', () => {
    // Every match is marked, so without this you cannot tell which of two
    // visible matches you navigated to.
    const passive = renderBody('the budget', 'budget').container.querySelector('mark')
    const activeMark = renderBody('the budget', 'budget', true).container.querySelector('mark')
    expect(passive?.className).not.toEqual(activeMark?.className)
    expect(activeMark?.className).toContain('bg-primary')
    expect(passive?.className).toContain('bg-status-warning-bg')
  })

  it('keeps the message readable — marking changes nothing but the marks', () => {
    const { container } = renderBody('review the budget before Friday', 'budget')
    expect(container.textContent).toBe('review the budget before Friday')
  })

  it('marks around a mention without disturbing the chip', () => {
    const { container } = render(
      <MessageBody
        body="ask <@11111111-1111-1111-1111-111111111111> about budget"
        mentionNames={{ '11111111-1111-1111-1111-111111111111': 'Bo' }}
        currentUserId="me"
        highlight={planFor('budget')}
      />,
    )
    // The chip still renders as a chip, and the raw token never appears.
    expect(screen.getByText('@Bo')).toBeTruthy()
    expect(container.textContent).toBe('ask @Bo about budget')
    expect([...container.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
      'budget',
    ])
  })

  it('never marks inside a mention chip', () => {
    // Indexing strips mentions, so a message is not findable by the name shown
    // on its chip. Marking the chip would promise a match that the search
    // could not have produced — and the name is resolved at render time, so it
    // is not what was searched anyway.
    const { container } = render(
      <MessageBody
        body="ask <@11111111-1111-1111-1111-111111111111> now"
        mentionNames={{ '11111111-1111-1111-1111-111111111111': 'Budget Team' }}
        currentUserId="me"
        highlight={planFor('budget')}
      />,
    )
    expect(screen.getByText('@Budget Team')).toBeTruthy()
    expect(container.querySelectorAll('mark')).toHaveLength(0)
  })

  it('renders a body that looks like markup as text, highlighted or not', () => {
    // A message body is user input. Highlighting splits the string and places
    // the pieces as children; it never assigns HTML, and this is the test that
    // says so.
    const body = '<b>bold</b> budget'
    const { container } = renderBody(body, 'budget')
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toBe(body)
  })
  it('marks the near-miss word when nothing matched exactly', () => {
    // A typo returns the message but has no exact run to mark. Left unmarked it
    // is a result with no visible reason — which is indistinguishable, to the
    // reader, from the search being wrong.
    const { container } = renderBody('revoir le budget avant la reunion', 'budgt')
    expect([...container.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
      'budget',
    ])
  })

  it('marks nothing when no word is close enough', () => {
    // The fallback explains a match; it must not invent one.
    const { container } = renderBody('revoir le budget avant la reunion', 'zzzz')
    expect(container.querySelectorAll('mark')).toHaveLength(0)
  })

  it('prefers an exact match over a near miss', () => {
    const { container } = renderBody('the budget and the budgie', 'budget')
    expect([...container.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
      'budget',
    ])
  })
})
