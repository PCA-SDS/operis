/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { cleanup, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CalendarTabs } from '../CalendarTabs'
import type { CalendarTab, CalendarView } from '../types'

const COUNTS = { all: 5, meetings: 3, events: 2 }

function renderTabs(overrides?: {
  tab?: CalendarTab
  view?: CalendarView
  onTabChange?: (tab: CalendarTab) => void
  onViewChange?: (view: CalendarView) => void
}) {
  return renderWithProviders(
    <CalendarTabs
      tab={overrides?.tab ?? 'all'}
      counts={COUNTS}
      view={overrides?.view ?? 'week'}
      onTabChange={overrides?.onTabChange ?? jest.fn()}
      onViewChange={overrides?.onViewChange ?? jest.fn()}
    />,
  )
}

describe('CalendarTabs', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the category filter as a segmented control, not a tablist', () => {
    const { getByRole, queryAllByRole } = renderTabs()

    const categoryFilter = getByRole('radiogroup', { name: 'Calendar category' })
    expect(categoryFilter.getAttribute('data-slot')).toBe('segmented-control')
    expect(queryAllByRole('tab')).toHaveLength(0)
    expect(queryAllByRole('tablist')).toHaveLength(0)
  })

  it('keeps the view switcher a separate segmented control', () => {
    const { getByRole, getAllByRole } = renderTabs()

    expect(getAllByRole('radiogroup')).toHaveLength(2)
    const viewSwitcher = getByRole('radiogroup', { name: 'Calendar view' })
    expect(viewSwitcher.getAttribute('data-slot')).toBe('segmented-control')
  })

  it('names each category segment by its label and count, ignoring the icon', () => {
    const { getByRole } = renderTabs()
    const categoryFilter = getByRole('radiogroup', { name: 'Calendar category' })

    expect(categoryFilter.querySelectorAll('[role="radio"]')).toHaveLength(3)
    expect(getByRole('radio', { name: 'All Scheduled' })).toBeInTheDocument()
    expect(getByRole('radio', { name: 'Meetings (3)' })).toBeInTheDocument()
    expect(getByRole('radio', { name: 'Events (2)' })).toBeInTheDocument()
  })

  it('marks the active tab as the checked segment', () => {
    const { getByRole } = renderTabs({ tab: 'meetings' })

    expect(getByRole('radio', { name: 'Meetings (3)' }).getAttribute('aria-checked')).toBe('true')
    expect(getByRole('radio', { name: 'All Scheduled' }).getAttribute('aria-checked')).toBe('false')
    expect(getByRole('radio', { name: 'Events (2)' }).getAttribute('aria-checked')).toBe('false')
  })

  it('reports the selected category through onTabChange', () => {
    const onTabChange = jest.fn()
    const { getByRole } = renderTabs({ onTabChange })

    fireEvent.click(getByRole('radio', { name: 'Events (2)' }))

    expect(onTabChange).toHaveBeenCalledTimes(1)
    expect(onTabChange).toHaveBeenCalledWith('events')
  })

  it('reports the selected view through onViewChange', () => {
    const onViewChange = jest.fn()
    const { getByRole } = renderTabs({ onViewChange })

    fireEvent.click(getByRole('radio', { name: 'Month' }))

    expect(onViewChange).toHaveBeenCalledTimes(1)
    expect(onViewChange).toHaveBeenCalledWith('month')
  })

  it('translates both controls from the active locale', () => {
    const { getByRole } = renderWithProviders(
      <CalendarTabs
        tab="all"
        counts={COUNTS}
        view="week"
        onTabChange={jest.fn()}
        onViewChange={jest.fn()}
      />,
      { locale: 'pl', dict: { 'customers.calendar.tabs.label': 'Kategoria kalendarza' } },
    )

    expect(getByRole('radiogroup', { name: 'Kategoria kalendarza' })).toBeInTheDocument()
  })
})
