/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { cleanup } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { UpcomingCards } from '../UpcomingCards'
import { buildCalendarItem } from './fixtures'
import type { UpcomingCard } from '../types'

const CARDS: UpcomingCard[] = [
  // `locationKind: 'url'` is what puts the Join affordance on the card, so the
  // link-button exclusion below is exercised rather than hypothetical.
  {
    item: buildCalendarItem({ id: 'a', title: 'Kickoff', locationKind: 'url' }),
    kind: 'today',
    conflictCount: 0,
  },
]

function renderCards() {
  return renderWithProviders(
    <UpcomingCards
      cards={CARDS}
      canManage
      onJoin={jest.fn()}
      onSeeConflict={jest.fn()}
      onOpen={jest.fn()}
      onEdit={jest.fn()}
      onCancel={jest.fn()}
    />,
    { locale: 'en' },
  )
}

afterEach(() => {
  cleanup()
})

describe('UpcomingCards', () => {
  it('stands its controls at the same height as the rest of the calendar chrome', () => {
    // The card's overflow trigger was `size="xs"` (24px) while every other
    // control on the calendar's surfaces is 36px. Join / See Conflict are
    // `LinkButton`s — inline text with no height variant at all, not boxes that
    // could carry one — so they are excluded by slot rather than by height.
    const { container } = renderCards()
    const controls = Array.from(container.querySelectorAll('button')).filter(
      (node) => node.getAttribute('data-slot') !== 'link-button',
    )

    expect(container.querySelector('[data-slot="link-button"]')).not.toBeNull()
    expect(controls.length).toBeGreaterThan(0)
    for (const control of controls) {
      expect(control.className).toMatch(/\b(h-9|size-9)\b/)
      expect(control.className).not.toMatch(/\b(size-6|size-7|size-8|h-6|h-7|h-8|h-10|h-11)\b/)
    }
  })
})
