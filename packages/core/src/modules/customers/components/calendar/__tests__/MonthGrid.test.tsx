/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { cleanup, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { MonthGrid } from '../MonthGrid'
import { formatTimeRange } from '../EventBlock'
import type { CalendarItem } from '../types'
import { buildCalendarItem } from './fixtures'

const MONTH_ANCHOR = new Date(2026, 7, 10, 12, 0, 0)

function renderGrid(locale: string, items: CalendarItem[] = []) {
  return renderWithProviders(
    <MonthGrid anchor={MONTH_ANCHOR} items={items} onItemClick={jest.fn()} onDayOpen={jest.fn()} />,
    { locale },
  )
}

function weekdayHeaderText(container: HTMLElement): string {
  return container.firstElementChild?.firstElementChild?.textContent ?? ''
}

function dayCellLabel(container: HTMLElement): string {
  return container.querySelector('button[aria-label]')?.getAttribute('aria-label') ?? ''
}

function eventPillLabel(container: HTMLElement): string {
  return container.querySelector('button[aria-label*="–"]')?.getAttribute('aria-label') ?? ''
}

function eventPillLabelByTitle(container: HTMLElement, title: string): string {
  return container.querySelector(`button[aria-label^="${title}"]`)?.getAttribute('aria-label') ?? ''
}

describe('MonthGrid — locale-aware date formatting (#5116)', () => {
  afterEach(() => {
    cleanup()
  })

  it('formats the weekday header row using the application locale, not the browser/OS locale', () => {
    const en = renderGrid('en')
    const enText = weekdayHeaderText(en.container)
    en.unmount()

    const pl = renderGrid('pl')
    const plText = weekdayHeaderText(pl.container)
    pl.unmount()

    expect(enText).not.toBe('')
    expect(plText).not.toBe('')
    expect(plText).not.toBe(enText)
    expect(enText.toUpperCase()).toContain('MON')
    expect(plText.toUpperCase()).toContain('PON')
  })

  it('formats the day-cell full date label using the application locale, not the browser/OS locale', () => {
    const en = renderGrid('en')
    const enLabel = dayCellLabel(en.container)
    en.unmount()

    const pl = renderGrid('pl')
    const plLabel = dayCellLabel(pl.container)
    pl.unmount()

    expect(enLabel).not.toBe('')
    expect(plLabel).not.toBe('')
    expect(plLabel).not.toBe(enLabel)
  })

  it('formats the event pill time range using the application locale, not the browser/OS locale', () => {
    const items = [buildCalendarItem()]

    const en = renderGrid('en', items)
    const enLabel = eventPillLabel(en.container)
    en.unmount()

    const pl = renderGrid('pl', items)
    const plLabel = eventPillLabel(pl.container)
    pl.unmount()

    expect(enLabel).not.toBe('')
    expect(plLabel).not.toBe('')
    expect(plLabel).not.toBe(enLabel)
  })
})

describe('MonthGrid — shared time-range formatting (#5275)', () => {
  afterEach(() => {
    cleanup()
  })

  it.each(['pl', 'de'])(
    'renders the event pill range exactly as the week view renders it in %s',
    (locale) => {
      const item = buildCalendarItem()

      const view = renderGrid(locale, [item])
      const pillLabel = eventPillLabelByTitle(view.container, item.title)
      view.unmount()

      expect(pillLabel).toBe(`${item.title} · ${formatTimeRange(locale, item.start, item.end)}`)
    },
  )
})

describe('MonthGrid — multi-day entries', () => {
  afterEach(() => {
    cleanup()
  })

  function labelled(container: HTMLElement, fragment: string): HTMLElement[] {
    return Array.from(container.querySelectorAll('button[aria-label]')).filter((node) =>
      (node.getAttribute('aria-label') ?? '').includes(fragment),
    ) as HTMLElement[]
  }

  it('keeps a multi-day entry visible on every day it covers', () => {
    // The regression: bucketing by start date alone dropped days 2..n entirely.
    const item = buildCalendarItem({
      id: 'conference',
      title: 'Annual conference',
      allDay: true,
      start: new Date(2026, 7, 10, 0, 0, 0),
      end: new Date(2026, 7, 14, 0, 0, 0),
    })
    const { container } = renderGrid('en', [item])
    const bars = labelled(container, 'Annual conference')
    expect(bars).toHaveLength(1)
    // Four of the row's seven columns.
    expect(bars[0].style.width).toContain('57.14')
    expect(bars[0].style.insetInlineStart).toContain('0%')
  })

  it('splits an entry crossing a week boundary into two continuous segments', () => {
    const item = buildCalendarItem({
      id: 'sprint',
      title: 'Sprint window',
      allDay: true,
      start: new Date(2026, 7, 14, 0, 0, 0),
      end: new Date(2026, 7, 19, 0, 0, 0),
    })
    const { container } = renderGrid('en', [item])
    expect(labelled(container, 'Sprint window')).toHaveLength(2)
  })

  it('renders a timed entry that crosses midnight as a spanning bar', () => {
    const item = buildCalendarItem({
      id: 'overnight',
      title: 'Overnight run',
      start: new Date(2026, 7, 12, 23, 0),
      end: new Date(2026, 7, 13, 1, 0),
    })
    const { container } = renderGrid('en', [item])
    expect(labelled(container, 'Overnight run')).toHaveLength(1)
  })

  it('collapses a crowded day behind an overflow control instead of truncating', () => {
    const items = Array.from({ length: 9 }, (_, index) =>
      buildCalendarItem({
        id: `meeting-${index}`,
        title: `Meeting ${index}`,
        start: new Date(2026, 7, 10, 9 + index, 0),
        end: new Date(2026, 7, 10, 9 + index, 30),
      }),
    )
    const { container } = renderGrid('en', items)
    expect(container.textContent).toContain('more')
    expect(labelled(container, 'Meeting ').length).toBeLessThan(items.length)
  })
})

describe('MonthGrid — interaction consistency with the week view', () => {
  afterEach(() => {
    cleanup()
  })

  function renderWithHandlers(items: CalendarItem[], onItemClick = jest.fn()) {
    const view = renderWithProviders(
      <MonthGrid
        anchor={MONTH_ANCHOR}
        items={items}
        onItemClick={onItemClick}
        onJoin={jest.fn()}
        onDayOpen={jest.fn()}
      />,
      { locale: 'en' },
    )
    return { view, onItemClick }
  }

  it('opens the peek popover on click rather than jumping straight to the editor', async () => {
    const item = buildCalendarItem()
    const { view, onItemClick } = renderWithHandlers([item])

    const pill = view.container.querySelector(`button[aria-label^="${item.title}"]`) as HTMLElement
    expect(pill).not.toBeNull()
    fireEvent.click(pill)

    // Same affordances the week view's popover offers.
    expect(await view.findByRole('button', { name: 'Edit' })).toBeVisible()
    expect(onItemClick).not.toHaveBeenCalled()
  })

  it('reaches the editor through the popover Edit action', async () => {
    const item = buildCalendarItem()
    const { view, onItemClick } = renderWithHandlers([item])

    fireEvent.click(view.container.querySelector(`button[aria-label^="${item.title}"]`) as HTMLElement)
    fireEvent.click(await view.findByRole('button', { name: 'Edit' }))

    expect(onItemClick).toHaveBeenCalledWith(item)
  })

  it('opens the editor directly from the overflow list, without nesting popovers', async () => {
    const items = Array.from({ length: 9 }, (_, index) =>
      buildCalendarItem({
        id: `meeting-${index}`,
        title: `Meeting ${index}`,
        start: new Date(2026, 7, 10, 9 + index, 0),
        end: new Date(2026, 7, 10, 9 + index, 30),
      }),
    )
    const { view, onItemClick } = renderWithHandlers(items)

    fireEvent.click(view.getByRole('button', { name: /\+\d+ more/ }))
    const row = (await view.findAllByRole('button', { name: /^Meeting 8 · / }))[0]
    fireEvent.click(row)

    expect(onItemClick).toHaveBeenCalledTimes(1)
  })
})
