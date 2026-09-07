/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { cleanup, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CalendarHeader } from '../CalendarHeader'
import type { CalendarView } from '../types'

const ANCHOR = new Date(2026, 8, 16, 10, 0, 0)
const RANGE = { from: new Date(2026, 8, 14), to: new Date(2026, 8, 20) }

type Overrides = {
  view?: CalendarView
  onPrevious?: () => void
  onNext?: () => void
  onToday?: () => void
  onViewChange?: (view: CalendarView) => void
  onNewEvent?: () => void
  onOpenShortcuts?: () => void
}

function renderHeader(overrides: Overrides = {}) {
  return renderWithProviders(
    <CalendarHeader
      view={overrides.view ?? 'week'}
      anchor={ANCHOR}
      range={RANGE}
      onPrevious={overrides.onPrevious ?? jest.fn()}
      onNext={overrides.onNext ?? jest.fn()}
      onToday={overrides.onToday ?? jest.fn()}
      onViewChange={overrides.onViewChange ?? jest.fn()}
      onNewEvent={overrides.onNewEvent ?? jest.fn()}
      onOpenShortcuts={overrides.onOpenShortcuts ?? jest.fn()}
    />,
  )
}

describe('CalendarHeader', () => {
  afterEach(() => {
    cleanup()
  })

  it('gathers Today, both arrows, the date and the create action onto one bar', () => {
    const { getByRole } = renderHeader()

    expect(getByRole('button', { name: 'Today' })).toBeInTheDocument()
    expect(getByRole('button', { name: 'Previous week' })).toBeInTheDocument()
    expect(getByRole('button', { name: 'Next week' })).toBeInTheDocument()
    expect(getByRole('button', { name: 'New event' })).toBeInTheDocument()
    expect(getByRole('heading', { level: 1 })).toHaveTextContent('2026')
  })

  it('hosts the view switcher as a segmented control', () => {
    const { getByRole } = renderHeader()

    const viewSwitcher = getByRole('radiogroup', { name: 'Calendar view' })
    expect(viewSwitcher.getAttribute('data-slot')).toBe('segmented-control')
    expect(viewSwitcher.querySelectorAll('[role="radio"]')).toHaveLength(4)
  })

  it('marks the active view as the checked segment', () => {
    const { getByRole } = renderHeader({ view: 'month' })

    expect(getByRole('radio', { name: 'Month' }).getAttribute('aria-checked')).toBe('true')
    expect(getByRole('radio', { name: 'Week' }).getAttribute('aria-checked')).toBe('false')
  })

  it('reports the selected view through onViewChange', () => {
    const onViewChange = jest.fn()
    const { getByRole } = renderHeader({ onViewChange })

    fireEvent.click(getByRole('radio', { name: 'Month' }))

    expect(onViewChange).toHaveBeenCalledTimes(1)
    expect(onViewChange).toHaveBeenCalledWith('month')
  })

  it('names the navigation arrows for the unit the current view moves by', () => {
    const { getByRole } = renderHeader({ view: 'month' })

    expect(getByRole('button', { name: 'Previous month' })).toBeInTheDocument()
    expect(getByRole('button', { name: 'Next month' })).toBeInTheDocument()
  })

  it('keeps search and filters off the bar, so the date label is never squeezed out', () => {
    const { getByRole, queryByRole } = renderHeader({ view: 'day' })

    expect(queryByRole('textbox')).toBeNull()
    expect(queryByRole('button', { name: 'Filter' })).toBeNull()
    expect(getByRole('heading', { level: 1 }).className).toContain('flex-1')
  })

  it('keeps a keyboard-shortcuts affordance now that the footer legend is gone', () => {
    const onOpenShortcuts = jest.fn()
    const { getByRole } = renderHeader({ onOpenShortcuts })

    fireEvent.click(getByRole('button', { name: 'Keyboard shortcuts' }))

    expect(onOpenShortcuts).toHaveBeenCalledTimes(1)
  })

  it('stands every control on the bar at one height', () => {
    // The primitives disagree about what their size names mean — `sm` is 32px
    // on Button but 28px on IconButton — so matching the prop name across the
    // two is what put three heights on one row. The bar is 36px throughout.
    const { container } = renderHeader()
    const controls = Array.from(
      container.querySelectorAll('button, [data-slot="segmented-control"]'),
    ).filter((node) => !node.closest('[data-slot="segmented-control"]') || node.matches('[data-slot="segmented-control"]'))

    expect(controls.length).toBeGreaterThanOrEqual(6)
    for (const control of controls) {
      expect(control.className).toMatch(/\b(h-9|size-9)\b/)
      expect(control.className).not.toMatch(/\b(size-6|size-7|size-8|h-7|h-8|h-10|h-11)\b/)
    }
  })

  it('titles the agenda view by name rather than by date range', () => {
    const { getByRole } = renderHeader({ view: 'agenda' })

    expect(getByRole('heading', { level: 1 })).toHaveTextContent('Upcoming')
  })

  it('omits controls the caller does not supply, so a read-only user sees no create action', () => {
    const { queryByRole } = renderWithProviders(
      <CalendarHeader view="week" anchor={ANCHOR} range={RANGE} onViewChange={jest.fn()} />,
    )

    expect(queryByRole('button', { name: 'New event' })).toBeNull()
    expect(queryByRole('button', { name: 'Today' })).toBeNull()
  })
})
