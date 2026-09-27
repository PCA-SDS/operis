/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DateTimeFields } from '../DateTimeFields'

jest.mock('@open-mercato/ui/primitives/select', () => {
  const React = require('react')
  return {
    Select: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    SelectValue: () => null,
    SelectContent: () => null,
    SelectItem: () => null,
  }
})

function renderFields(overrides: Partial<React.ComponentProps<typeof DateTimeFields>> = {}) {
  const props: React.ComponentProps<typeof DateTimeFields> = {
    visible: new Set(['date']),
    activityType: 'meeting',
    date: '2026-09-27',
    setDate: () => {},
    startTime: '09:00',
    setStartTime: () => {},
    duration: 30,
    setDuration: () => {},
    allDay: false,
    setAllDay: () => {},
    recurrenceEnabled: false,
    setRecurrenceEnabled: () => {},
    recurrenceDays: [true, false, false, false, false, false, false],
    toggleRecurrenceDay: () => {},
    recurrenceEndType: 'never',
    setRecurrenceEndType: () => {},
    recurrenceCount: 8,
    setRecurrenceCount: () => {},
    recurrenceEndDate: '',
    setRecurrenceEndDate: () => {},
    ...overrides,
  }
  return renderWithProviders(<DateTimeFields {...props} />)
}

describe('DateTimeFields', () => {
  it('draws All day as a switch, as the calendar event editor does', () => {
    const setAllDay = jest.fn()
    renderFields({ setAllDay })
    expect(screen.queryByRole('checkbox', { name: 'All day' })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'All day' }))
    expect(setAllDay).toHaveBeenCalledWith(true)
  })

  it('shows the repeat toggle pressed only while recurrence is on', () => {
    const { unmount } = renderFields()
    expect(screen.getByRole('button', { name: 'No repeat' })).toHaveAttribute('aria-pressed', 'false')
    unmount()
    renderFields({ recurrenceEnabled: true })
    expect(screen.getByRole('button', { name: 'Repeats' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('picks recurrence days with the shared weekday toggles, outside any status-coloured box', () => {
    const toggleRecurrenceDay = jest.fn()
    const { container } = renderFields({ recurrenceEnabled: true, toggleRecurrenceDay })
    expect(screen.getByRole('button', { name: 'MON' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'WED' }))
    expect(toggleRecurrenceDay).toHaveBeenCalledWith(2)
    expect(container.querySelector('[class*="status-warning"]')).toBeNull()
  })
})
