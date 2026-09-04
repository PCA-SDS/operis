/**
 * @jest-environment jsdom
 */

/**
 * The reaction chips, and the difference between someone who can react and
 * someone who can only look.
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MessageReactions } from '../components/MessageReactions'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: unknown, params?: Record<string, unknown>) => {
    const text = typeof fallback === 'string' ? fallback : String(_key)
    if (!params) return text
    return Object.entries(params).reduce(
      (acc, [name, value]) => acc.replace(`{${name}}`, String(value)),
      text,
    )
  },
}))

const THUMBS = { emoji: '👍', count: 2, mine: true, sampleNames: ['Ann', 'Bo'] }

describe('MessageReactions', () => {
  it('renders nothing when there are none, rather than an empty row', () => {
    const { container } = render(<MessageReactions reactions={[]} onToggle={jest.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('exposes the count and whether you are one of the people behind it', () => {
    render(<MessageReactions reactions={[THUMBS]} onToggle={jest.fn()} />)
    const chip = screen.getByRole('button', { name: '👍, 2 reacted' })
    // `aria-pressed`, not colour alone — a reader who cannot see the tint still
    // learns they reacted.
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('toggles the emoji it shows', () => {
    const onToggle = jest.fn()
    render(<MessageReactions reactions={[THUMBS]} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: '👍, 2 reacted' }))
    expect(onToggle).toHaveBeenCalledWith('👍')
  })

  describe('read-only viewer', () => {
    /**
     * A `disabled` button emits no pointer events, so wrapping one in a tooltip
     * meant the person who most needs "who reacted?" — someone who cannot react
     * and can only look — was the one person who could never see it.
     */
    it('is a label, not a disabled control', () => {
      render(<MessageReactions reactions={[THUMBS]} onToggle={jest.fn()} disabled />)

      expect(screen.queryByRole('button')).toBeNull()
      const chip = screen.getByRole('img', { name: '👍, 2 reacted' })
      // Nothing to press, so it claims no pressed state and no tab stop.
      expect(chip.getAttribute('aria-pressed')).toBeNull()
      expect(chip.getAttribute('disabled')).toBeNull()
      expect(chip.getAttribute('tabindex')).toBeNull()
    })

    it('still reports the count', () => {
      render(<MessageReactions reactions={[THUMBS]} onToggle={jest.fn()} disabled />)
      expect(screen.getByRole('img', { name: '👍, 2 reacted' }).textContent).toContain('2')
    })

    it('cannot toggle', () => {
      const onToggle = jest.fn()
      render(<MessageReactions reactions={[THUMBS]} onToggle={onToggle} disabled />)
      fireEvent.click(screen.getByRole('img', { name: '👍, 2 reacted' }))
      expect(onToggle).not.toHaveBeenCalled()
    })
  })

  it('keeps one chip per emoji, aggregated', () => {
    render(
      <MessageReactions
        reactions={[THUMBS, { emoji: '🎉', count: 1, mine: false, sampleNames: ['Cy'] }]}
        onToggle={jest.fn()}
      />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '🎉, 1 reacted' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })
})
