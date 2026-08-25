/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ScheduleItem } from '../types'

/**
 * react-big-calendar treats `components.event` as a component *type*. If its identity
 * changes, React unmounts and remounts every event cell in the view — focus is lost and
 * dense months flash. The renderer therefore has to stay stable while still calling the
 * caller's current `onItemClick`.
 */

jest.mock('react-big-calendar/lib/css/react-big-calendar.css', () => ({}), { virtual: true })

type CalendarProps = {
  events: { id: string; resource: ScheduleItem }[]
  components: { event: React.ComponentType<{ event: { resource: ScheduleItem } }> }
}

const calendarProps: CalendarProps[] = []

jest.mock('react-big-calendar', () => ({
  dateFnsLocalizer: () => ({}),
  Calendar: (props: CalendarProps) => {
    calendarProps.push(props)
    const EventComponent = props.components.event
    return (
      <div>
        {props.events.map((event) => (
          <EventComponent key={event.id} event={event} />
        ))}
      </div>
    )
  },
}))

import ScheduleCalendar from '../ScheduleCalendar'

const ITEMS: ScheduleItem[] = [
  {
    id: 'item-1',
    kind: 'event',
    title: 'Kickoff call',
    startsAt: new Date('2026-03-10T09:00:00Z'),
    endsAt: new Date('2026-03-10T10:00:00Z'),
    linkLabel: 'Open',
  },
]

const RANGE = { start: new Date('2026-03-01T00:00:00Z'), end: new Date('2026-03-31T23:59:59Z') }

function renderCalendar(onItemClick: (item: ScheduleItem) => void) {
  return render(
    <ScheduleCalendar
      items={ITEMS}
      view="month"
      range={RANGE}
      onRangeChange={() => {}}
      onViewChange={() => {}}
      onItemClick={onItemClick}
    />,
  )
}

beforeEach(() => {
  calendarProps.length = 0
})

describe('ScheduleCalendar', () => {
  test('keeps the event renderer identity when onItemClick changes, so cells are not remounted', () => {
    const first = jest.fn()
    const { rerender } = renderCalendar(first)

    const cellBefore = screen.getByText('Kickoff call')

    const second = jest.fn()
    rerender(
      <ScheduleCalendar
        items={ITEMS}
        view="month"
        range={RANGE}
        onRangeChange={() => {}}
        onViewChange={() => {}}
        onItemClick={second}
      />,
    )

    expect(calendarProps.length).toBeGreaterThan(1)
    expect(calendarProps[0]!.components).toBe(calendarProps[calendarProps.length - 1]!.components)
    expect(calendarProps[0]!.components.event).toBe(calendarProps[calendarProps.length - 1]!.components.event)
    // Same component type ⇒ React kept the subtree; a new type would have produced a new node.
    expect(screen.getByText('Kickoff call')).toBe(cellBefore)
  })

  test('the stable renderer still calls the latest onItemClick', () => {
    const first = jest.fn()
    const { rerender } = renderCalendar(first)

    const second = jest.fn()
    rerender(
      <ScheduleCalendar
        items={ITEMS}
        view="month"
        range={RANGE}
        onRangeChange={() => {}}
        onViewChange={() => {}}
        onItemClick={second}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }))
  })

  test('hides the link action when no handler is supplied', () => {
    render(
      <ScheduleCalendar
        items={ITEMS}
        view="month"
        range={RANGE}
        onRangeChange={() => {}}
        onViewChange={() => {}}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
  })
})
