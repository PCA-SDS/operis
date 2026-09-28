/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivitiesDayStrip } from '../ActivitiesDayStrip'
import type { InteractionSummary } from '../types'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
}))

function event(id: string, start: Date, duration: number): InteractionSummary {
  return {
    id,
    interactionType: 'meeting',
    title: id,
    body: null,
    status: 'planned',
    scheduledAt: start.toISOString(),
    occurredAt: null,
    priority: null,
    authorUserId: null,
    ownerUserId: null,
    appearanceIcon: null,
    appearanceColor: null,
    source: null,
    entityId: 'person-1',
    dealId: null,
    organizationId: null,
    tenantId: null,
    authorName: null,
    authorEmail: null,
    dealTitle: null,
    customValues: null,
    duration,
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
  }
}

function at(date: Date, hours: number, minutes = 0): Date {
  const next = new Date(date)
  next.setHours(hours, minutes, 0, 0)
  return next
}

// A Wednesday, so its week runs Monday 4 to Sunday 10 October 2027.
const selected = new Date(2027, 9, 6)

function dayButtons() {
  return within(screen.getByRole('group', { name: 'October 2027' })).getAllByRole('button')
}

describe('ActivitiesDayStrip', () => {
  it('draws the selected date’s Monday-to-Sunday week, with one set of arrows', () => {
    renderWithProviders(
      <ActivitiesDayStrip entityId="person-1" selectedDate={selected} onSelectDate={jest.fn()} events={[]} />,
    )

    const days = dayButtons()
    expect(days).toHaveLength(7)
    expect(days[0]).toHaveAccessibleName(/Monday.*4/)
    expect(days[6]).toHaveAccessibleName(/Sunday/)
    expect(days.filter((day) => day.getAttribute('aria-pressed') === 'true')).toEqual([days[2]])
    expect(screen.getAllByRole('button', { name: 'Previous week' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Next week' })).toHaveLength(1)
  })

  it('names each day’s load and marks overlapping events', () => {
    renderWithProviders(
      <ActivitiesDayStrip
        entityId="person-1"
        selectedDate={selected}
        onSelectDate={jest.fn()}
        events={[event('review', at(selected, 10), 60), event('call', at(selected, 10, 30), 30)]}
      />,
    )

    const busy = screen.getByRole('button', { name: /2 events · 1h/ })
    expect(busy).toBe(dayButtons()[2])
    const dots = busy.querySelectorAll('.rounded-full.size-1\\.5')
    expect(dots).toHaveLength(2)
    dots.forEach((dot) => expect(dot.className).toContain('bg-status-error-icon'))
  })

  it('moves the selection a week at a time and comes back with Today', () => {
    const onSelectDate = jest.fn()
    const { rerender } = renderWithProviders(
      <ActivitiesDayStrip entityId="person-1" selectedDate={selected} onSelectDate={onSelectDate} events={[]} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    const nextWeek = onSelectDate.mock.calls.at(-1)?.[0] as Date
    expect(nextWeek.getDate()).toBe(13)
    rerender(<ActivitiesDayStrip entityId="person-1" selectedDate={nextWeek} onSelectDate={onSelectDate} events={[]} />)
    // The strip is always the selected day's week.
    expect(dayButtons()[0]).toHaveAccessibleName(/11/)
    expect(dayButtons()[2]).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    expect((onSelectDate.mock.calls.at(-1)?.[0] as Date).getDate()).toBe(6)

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    const picked = onSelectDate.mock.calls.at(-1)?.[0] as Date
    const today = new Date()
    expect(picked.toDateString()).toBe(today.toDateString())
  })

  it('selects a day when it is pressed', () => {
    const onSelectDate = jest.fn()
    renderWithProviders(
      <ActivitiesDayStrip entityId="person-1" selectedDate={selected} onSelectDate={onSelectDate} events={[]} />,
    )
    fireEvent.click(dayButtons()[4])
    expect((onSelectDate.mock.calls[0][0] as Date).getDate()).toBe(8)
  })
})
