/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { WeekdayToggles } from '../inputs'

describe('WeekdayToggles', () => {
  const days = [true, false, true, false, false, false, false]

  it('draws one toggle per day, Monday first, named by the day', () => {
    renderWithProviders(<WeekdayToggles days={days} onToggle={() => {}} />)
    const toggles = screen.getAllByRole('button')
    expect(toggles.map((toggle) => toggle.getAttribute('aria-label'))).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])
    expect(toggles.map((toggle) => toggle.textContent)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
  })

  it('reports each day as pressed or not', () => {
    renderWithProviders(<WeekdayToggles days={days} onToggle={() => {}} />)
    expect(screen.getAllByRole('button').map((toggle) => toggle.getAttribute('aria-pressed'))).toEqual(
      ['true', 'false', 'true', 'false', 'false', 'false', 'false'],
    )
  })

  it('hands back the index of the day that was clicked', () => {
    const onToggle = jest.fn()
    renderWithProviders(<WeekdayToggles days={days} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: 'THU' }))
    expect(onToggle).toHaveBeenCalledWith(3)
  })

  it('is the shared toggle button, the same shape and pressed look as every other toggle', () => {
    renderWithProviders(<WeekdayToggles days={days} onToggle={() => {}} />)
    for (const toggle of screen.getAllByRole('button')) {
      expect(toggle.className).toContain('aria-pressed:bg-sidebar')
      expect(toggle.className.split(/\s+/)).toContain('size-9')
      expect(toggle.className.split(/\s+/)).not.toContain('rounded-full')
    }
  })
})
