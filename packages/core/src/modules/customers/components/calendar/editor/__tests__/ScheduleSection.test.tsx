/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ScheduleSection } from '../ScheduleSection'

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

function renderSection(onAllDayChange: (next: boolean) => void = () => {}) {
  return renderWithProviders(
    <ScheduleSection
      dateLabel="starts"
      hasAllDay
      hasEnd
      allDay={false}
      date="2026-09-27"
      startTime="09:00"
      endDate="2026-09-27"
      endTime="10:00"
      locale="en"
      onAllDayChange={onAllDayChange}
      onDateChange={() => {}}
      onStartTimeChange={() => {}}
      onEndDateChange={() => {}}
      onEndTimeChange={() => {}}
    />,
  )
}

describe('ScheduleSection all-day control', () => {
  it('is a switch named by its visible label', () => {
    renderSection()
    const allDay = screen.getByRole('switch', { name: 'All day' })
    expect(allDay).toHaveAttribute('aria-checked', 'false')
  })

  it('flips from the label as well as from the switch', () => {
    const onAllDayChange = jest.fn()
    renderSection(onAllDayChange)
    fireEvent.click(screen.getByText('All day'))
    expect(onAllDayChange).toHaveBeenCalledWith(true)
  })

  it('sets its label like the field labels beside it', () => {
    renderSection()
    const label = screen.getByText('All day').className.split(/\s+/)
    const fieldLabel = screen.getByText('Starts').className.split(/\s+/)
    for (const token of ['text-sm', 'font-medium', 'text-foreground']) {
      expect(label).toContain(token)
      expect(fieldLabel).toContain(token)
    }
  })
})
