/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ViewSwitcher } from '../ViewSwitcher'

describe('ViewSwitcher', () => {
  function renderSwitcher(overrides: Partial<React.ComponentProps<typeof ViewSwitcher>> = {}) {
    const props: React.ComponentProps<typeof ViewSwitcher> = {
      viewMode: 'weekly',
      onViewModeChange: () => {},
      viewType: 'timesheet',
      onViewTypeChange: () => {},
      ...overrides,
    }
    return renderWithProviders(<ViewSwitcher {...props} />)
  }

  it('is two shared segmented controls, each with its choice checked', () => {
    const { container } = renderSwitcher()
    expect(container.querySelectorAll('[data-slot="segmented-control"]')).toHaveLength(2)
    expect(screen.getByRole('radiogroup', { name: 'Period' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Weekly' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Monthly' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: 'Timesheet' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'List view' })).toHaveAttribute('aria-checked', 'false')
  })

  it('reports the period and the view that were picked', () => {
    const onViewModeChange = jest.fn()
    const onViewTypeChange = jest.fn()
    renderSwitcher({ onViewModeChange, onViewTypeChange })
    fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }))
    fireEvent.click(screen.getByRole('radio', { name: 'List view' }))
    expect(onViewModeChange).toHaveBeenCalledWith('monthly')
    expect(onViewTypeChange).toHaveBeenCalledWith('list')
  })
})
