/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { cleanup, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { TimeGrid } from '../TimeGrid'
import type { CalendarItem } from '../types'
import { buildCalendarItem } from './fixtures'
import { makeCalendarTaskItem } from '../../../lib/calendar/__tests__/fixtures'

const ANCHOR = new Date(2026, 7, 12, 10, 0, 0)

function renderGrid(items: CalendarItem[] = [], overrides: Partial<React.ComponentProps<typeof TimeGrid>> = {}) {
  return renderWithProviders(
    <TimeGrid
      days={7}
      anchor={ANCHOR}
      items={items}
      conflictIds={new Set()}
      showWeekends
      showConflicts={false}
      aiSummaries={false}
      onItemClick={jest.fn()}
      onJoin={jest.fn()}
      {...overrides}
    />,
    { locale: 'en' },
  )
}

function labelledButtons(container: HTMLElement, fragment: string): HTMLElement[] {
  return Array.from(container.querySelectorAll('button[aria-label]')).filter((node) =>
    (node.getAttribute('aria-label') ?? '').includes(fragment),
  ) as HTMLElement[]
}

afterEach(() => {
  cleanup()
  jest.useRealTimers()
})

describe('TimeGrid — all-day lane', () => {
  it('renders the lane even when nothing is all-day, so it stays a drop target', () => {
    const { container } = renderGrid([buildCalendarItem()])
    expect(container.textContent).toContain('All day')
  })

  it('renders a multi-day all-day entry as a single bar, not one chip per day', () => {
    const start = new Date(2026, 7, 10, 0, 0, 0)
    const item = buildCalendarItem({
      id: 'conference',
      title: 'Annual conference',
      allDay: true,
      start,
      end: new Date(2026, 7, 13, 0, 0, 0),
    })
    const { container } = renderGrid([item])
    expect(labelledButtons(container, 'Annual conference')).toHaveLength(1)
  })

  it('keeps simultaneous all-day entries in separate lanes', () => {
    const items = [
      buildCalendarItem({
        id: 'a',
        title: 'Trip A',
        allDay: true,
        start: new Date(2026, 7, 10),
        end: new Date(2026, 7, 13),
      }),
      buildCalendarItem({
        id: 'b',
        title: 'Trip B',
        allDay: true,
        start: new Date(2026, 7, 11),
        end: new Date(2026, 7, 14),
      }),
    ]
    const { container } = renderGrid(items)
    const tops = [...labelledButtons(container, 'Trip')].map((node) => node.style.top)
    expect(new Set(tops).size).toBe(2)
  })

  it('collapses a crowded lane behind an overflow control', () => {
    const items = Array.from({ length: 6 }, (_, index) =>
      buildCalendarItem({
        id: `all-day-${index}`,
        title: `Holiday ${index}`,
        allDay: true,
        start: new Date(2026, 7, 10),
        end: new Date(2026, 7, 13),
      }),
    )
    const { container } = renderGrid(items)
    expect(container.textContent).toContain('more')
    expect(labelledButtons(container, 'Holiday').length).toBeLessThan(items.length)
  })

  it('never renders an all-day entry as a midnight timed block', () => {
    const item = buildCalendarItem({
      id: 'holiday',
      title: 'Bank holiday',
      allDay: true,
      start: new Date(2026, 7, 12),
      end: new Date(2026, 7, 13),
    })
    const { container } = renderGrid([item])
    const rendered = labelledButtons(container, 'Bank holiday')
    expect(rendered).toHaveLength(1)
    expect(rendered[0].getAttribute('aria-label')).toContain('All day')
  })
})

describe('TimeGrid — timed placement', () => {
  it('positions a block by start time and sizes it by duration', () => {
    const item = buildCalendarItem({
      id: 'standup',
      title: 'Standup',
      start: new Date(2026, 7, 12, 9, 0),
      end: new Date(2026, 7, 12, 10, 0),
    })
    const { container } = renderGrid([item])
    const [block] = labelledButtons(container, 'Standup')
    // 48px per hour: 09:00 is 432px down and one hour is 48px tall, less the
    // 2px the block is inset by on every side.
    expect(Number.parseFloat(block.style.top)).toBeCloseTo(9 * 48 + 2, 0)
    expect(Number.parseFloat(block.style.height)).toBeCloseTo(48 - 4, 0)
  })

  it('splits a midnight crossing across both day columns', () => {
    const item = buildCalendarItem({
      id: 'overnight',
      title: 'Overnight run',
      start: new Date(2026, 7, 12, 23, 0),
      end: new Date(2026, 7, 13, 1, 0),
    })
    const { container } = renderGrid([item])
    expect(labelledButtons(container, 'Overnight run')).toHaveLength(2)
  })

  it('keeps a very short event clickable without displacing its top edge', () => {
    const item = buildCalendarItem({
      id: 'quick',
      title: 'Quick sync',
      start: new Date(2026, 7, 12, 9, 5),
      end: new Date(2026, 7, 12, 9, 10),
    })
    const { container } = renderGrid([item])
    const [block] = labelledButtons(container, 'Quick sync')
    expect(Number.parseFloat(block.style.top)).toBeCloseTo((9 * 60 + 5) * (48 / 60) + 2, 0)
    expect(Number.parseFloat(block.style.height)).toBeGreaterThanOrEqual(16)
  })

  it('gives simultaneous events equal side-by-side widths', () => {
    const items = [
      buildCalendarItem({
        id: 'one',
        title: 'Meeting one',
        start: new Date(2026, 7, 12, 9, 0),
        end: new Date(2026, 7, 12, 10, 0),
      }),
      buildCalendarItem({
        id: 'two',
        title: 'Meeting two',
        start: new Date(2026, 7, 12, 9, 0),
        end: new Date(2026, 7, 12, 10, 0),
      }),
    ]
    const { container } = renderGrid(items)
    const blocks = labelledButtons(container, 'Meeting ')
    expect(blocks).toHaveLength(2)
    const starts = blocks.map((node) => node.style.insetInlineStart)
    expect(new Set(starts).size).toBe(2)
    for (const node of blocks) expect(node.style.width).toContain('50%')
  })

  it('routes an entry of a full day or more to the all-day lane', () => {
    const item = buildCalendarItem({
      id: 'marathon',
      title: 'Marathon session',
      start: new Date(2026, 7, 12, 8, 0),
      end: new Date(2026, 7, 13, 12, 0),
    })
    const { container } = renderGrid([item])
    const rendered = labelledButtons(container, 'Marathon session')
    expect(rendered).toHaveLength(1)
    expect(rendered[0].getAttribute('aria-label')).toContain('All day')
  })
})

describe('TimeGrid — current-time indicator', () => {
  it('shows the indicator when today is in the visible range', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 12, 14, 30))
    const { container } = renderGrid()
    const indicator = container.querySelector('[aria-hidden="true"].z-40')
    expect(indicator).not.toBeNull()
    expect(Number.parseFloat((indicator as HTMLElement).style.top)).toBeCloseTo((14 * 60 + 30) * (48 / 60), 0)
  })

  it('omits the indicator when the range does not contain today', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 0, 5, 14, 30))
    const { container } = renderGrid()
    expect(container.querySelector('[aria-hidden="true"].z-40')).toBeNull()
  })
})

describe('TimeGrid — column dividers', () => {
  // jsdom applies no stylesheet, so these assert the classes the rows are
  // authored with, which is where the fault was: the timed strip also holds the
  // now-indicator overlay, and that overlay — not the seventh day — is its real
  // `:last-child`, so a `last:border-e-0` rule never reached the day it was
  // meant for. That left a line down the grid's right edge with nothing above
  // it in the all-day lane, and because `flex-basis: 0` shares out only what the
  // borders leave over, the extra border knocked every column a fraction of a
  // pixel out of step with that lane. Keying the divider off the index instead
  // makes both rows land on the same boundaries whether the overlay is there or
  // not, which the two cases below pin.
  function endBorderCounts(container: HTMLElement) {
    const carrying = (nodes: Element[]) => nodes.filter((node) => node.classList.contains('border-e')).length
    const lane = Array.from(container.querySelectorAll('.absolute.inset-0.flex > div'))
    const timed = Array.from(container.querySelectorAll('[role="gridcell"]'))
    return {
      lane: { columns: lane.length, withEndBorder: carrying(lane) },
      timed: { columns: timed.length, withEndBorder: carrying(timed) },
    }
  }

  const dividedButNotOnTheOuterEdge = {
    lane: { columns: 7, withEndBorder: 6 },
    timed: { columns: 7, withEndBorder: 6 },
  }

  it('divides between days and not on the outer edge, with the now indicator on screen', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 12, 14, 30))
    const { container } = renderGrid()
    expect(container.querySelector('[aria-hidden="true"].z-40')).not.toBeNull()
    expect(endBorderCounts(container)).toEqual(dividedButNotOnTheOuterEdge)
  })

  it('divides identically with the indicator absent, so the lines never shift with the clock', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 0, 5, 14, 30))
    const { container } = renderGrid()
    expect(container.querySelector('[aria-hidden="true"].z-40')).toBeNull()
    expect(endBorderCounts(container)).toEqual(dividedButNotOnTheOuterEdge)
  })
})

describe('TimeGrid — block inset', () => {
  it('insets an event block equally on all four sides', () => {
    const start = new Date(2026, 7, 12, 9, 0, 0)
    const end = new Date(2026, 7, 12, 9, 30, 0)
    const { container } = renderGrid([buildCalendarItem({ id: 'inset', title: 'Inset check', start, end })])
    const block = container.querySelector('button[style*="inset-inline-start"]') as HTMLElement
    expect(block).not.toBeNull()

    // The horizontal gap used to be subtracted from the width without being
    // added to the start, so the block sat flush against its column's left edge
    // with the whole gap on the right, while top and bottom got a different
    // value again — measured at left 0, right 2, top 1, bottom 1.
    const pxIn = (value: string, sign: '+' | '-') =>
      Number(new RegExp(`\\${sign} (\\d+(?:\\.\\d+)?)px`).exec(value)?.[1] ?? NaN)
    const startInset = pxIn(block.style.insetInlineStart, '+')
    const widthLost = pxIn(block.style.width, '-')

    // 09:00 at 48px an hour, half an hour long, before any inset is applied.
    const rawTop = 9 * 48
    const rawHeight = 24
    const topInset = Number.parseFloat(block.style.top) - rawTop
    const heightLost = rawHeight - Number.parseFloat(block.style.height)

    expect(startInset).toBeGreaterThan(0)
    expect(widthLost).toBe(startInset * 2)
    expect(topInset).toBe(startInset)
    expect(heightLost).toBe(startInset * 2)
  })
})

describe('TimeGrid — permissions', () => {
  it('exposes no resize affordance when the user cannot manage events', () => {
    const item = buildCalendarItem({ id: 'locked', title: 'Locked event' })
    const { container } = renderGrid([item], { canManage: false, onReschedule: jest.fn() })
    expect(container.querySelector('[title="Change start time"]')).toBeNull()
  })

  it('does not reschedule on a plain click', () => {
    const onReschedule = jest.fn()
    const item = buildCalendarItem({
      id: 'click-me',
      title: 'Click me',
      start: new Date(2026, 7, 12, 9, 0),
      end: new Date(2026, 7, 12, 10, 0),
    })
    const { container } = renderGrid([item], { onReschedule })
    const [block] = labelledButtons(container, 'Click me')
    fireEvent.pointerDown(block, { clientX: 100, clientY: 100, button: 0 })
    fireEvent.pointerUp(window, { clientX: 100, clientY: 100 })
    expect(onReschedule).not.toHaveBeenCalled()
  })

  it('moves an event by keyboard, so drag is not pointer-only', () => {
    const onReschedule = jest.fn()
    const item = buildCalendarItem({
      id: 'nudge',
      title: 'Nudge me',
      start: new Date(2026, 7, 12, 9, 0),
      end: new Date(2026, 7, 12, 10, 0),
    })
    const { container } = renderGrid([item], { onReschedule })
    const [block] = labelledButtons(container, 'Nudge me')
    fireEvent.keyDown(block, { key: 'ArrowDown' })
    expect(onReschedule).toHaveBeenCalledTimes(1)
    const change = onReschedule.mock.calls[0][0]
    expect(change.start.getHours()).toBe(9)
    expect(change.start.getMinutes()).toBe(15)
    expect(change.end.getTime() - change.start.getTime()).toBe(60 * 60 * 1000)
  })

  it('resizes by keyboard with the shift modifier', () => {
    const onReschedule = jest.fn()
    const item = buildCalendarItem({
      id: 'resize',
      title: 'Resize me',
      start: new Date(2026, 7, 12, 9, 0),
      end: new Date(2026, 7, 12, 10, 0),
    })
    const { container } = renderGrid([item], { onReschedule })
    const [block] = labelledButtons(container, 'Resize me')
    fireEvent.keyDown(block, { key: 'ArrowDown', shiftKey: true })
    const change = onReschedule.mock.calls[0][0]
    expect(change.start).toEqual(item.start)
    expect(change.end.getTime() - change.start.getTime()).toBe(75 * 60 * 1000)
  })
})

describe('TimeGrid — Task Manager tasks', () => {
  const taskAt = (start: Date, end: Date, overrides: Parameters<typeof makeCalendarTaskItem>[1] = {}) =>
    makeCalendarTaskItem({ id: 'task-1', title: 'Prepare proposal', start, end }, overrides)

  it('places a timed task by its due time, like any other entry', () => {
    const start = new Date(2026, 7, 12, 9, 0)
    const { container } = renderGrid([taskAt(start, new Date(2026, 7, 12, 10, 0))])
    const block = labelledButtons(container, 'Prepare proposal')[0]
    expect(block).toBeDefined()
    expect(Number.parseFloat(block.style.top)).toBeCloseTo(9 * 48 + 2, 0)
  })

  it('offers no resize handle on a task — its record stores no duration', () => {
    const start = new Date(2026, 7, 12, 9, 0)
    const { container } = renderGrid([taskAt(start, new Date(2026, 7, 12, 10, 0))], {
      canManage: true,
      onReschedule: jest.fn(),
    })
    expect(container.querySelector('[title="Change end time"]')).toBeNull()
  })

  it('still offers a resize handle on an event, so the block is task-specific', () => {
    const { container } = renderGrid(
      [buildCalendarItem({ start: new Date(2026, 7, 12, 9, 0), end: new Date(2026, 7, 12, 10, 0) })],
      { canManage: true, onReschedule: jest.fn() },
    )
    expect(container.querySelector('[title="Change end time"]')).not.toBeNull()
  })

  it('refuses a keyboard resize on a task but still moves it', () => {
    const onReschedule = jest.fn()
    const start = new Date(2026, 7, 12, 9, 0)
    const { container } = renderGrid([taskAt(start, new Date(2026, 7, 12, 10, 0))], {
      canManage: true,
      onReschedule,
    })
    const block = labelledButtons(container, 'Prepare proposal')[0]

    fireEvent.keyDown(block, { key: 'ArrowDown', shiftKey: true })
    expect(onReschedule).not.toHaveBeenCalled()

    fireEvent.keyDown(block, { key: 'ArrowDown' })
    expect(onReschedule).toHaveBeenCalledTimes(1)
  })

  it('puts a due-date-only task in the all-day lane, not at midnight', () => {
    const start = new Date(2026, 7, 12)
    const item = makeCalendarTaskItem(
      { id: 'task-2', title: 'Ship release', start, end: new Date(2026, 7, 13), allDay: true },
      { calendarTime: null },
    )
    const { container } = renderGrid([item])
    const rendered = labelledButtons(container, 'Ship release')
    expect(rendered).toHaveLength(1)
    expect(rendered[0].getAttribute('aria-label')).toContain('All day')
  })
})
