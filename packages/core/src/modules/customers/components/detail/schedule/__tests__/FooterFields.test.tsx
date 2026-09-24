/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { FooterFields } from '../FooterFields'

// Radix Select renders its content in a portal and depends on pointer APIs jsdom lacks,
// so the primitive is replaced with inline stand-ins: each item is an `option` that
// reports whether it is the selected value and forwards clicks to onValueChange.
jest.mock('@open-mercato/ui/primitives/select', () => {
  const React = require('react')
  const Ctx = React.createContext({ value: '', onValueChange: (_value: string) => {} })
  return {
    Select: ({ value, onValueChange, children }: any) =>
      React.createElement(Ctx.Provider, { value: { value, onValueChange } }, React.createElement('div', { role: 'listbox' }, children)),
    SelectTrigger: ({ children }: any) => React.createElement('div', null, children),
    SelectTriggerLeading: ({ children }: any) => React.createElement('span', null, children),
    SelectValue: () => null,
    SelectContent: ({ children }: any) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children }: any) => {
      const ctx = React.useContext(Ctx)
      return React.createElement(
        'button',
        { type: 'button', role: 'option', 'aria-selected': ctx.value === value, onClick: () => ctx.onValueChange(value) },
        children,
      )
    },
  }
})

describe('FooterFields — Reminder option labels (formatReminderLabel)', () => {
  function renderReminder(reminderMinutes: number, setReminderMinutes: (value: number) => void = () => {}) {
    return renderWithProviders(
      <FooterFields
        visible={new Set(['reminder', 'visibility'])}
        activityType="meeting"
        reminderMinutes={reminderMinutes}
        setReminderMinutes={setReminderMinutes}
        visibility="team"
        setVisibility={() => {}}
      />,
    )
  }

  const reminderOptions = () => Array.from(screen.getAllByRole('listbox')[0].querySelectorAll('[role="option"]'))
  const selectedReminder = () => reminderOptions().find((option) => option.getAttribute('aria-selected') === 'true')

  it('renders all reminder options with human-readable labels', () => {
    renderReminder(15)
    expect(reminderOptions().map((option) => option.textContent?.trim())).toEqual([
      'None',
      '5 min before',
      '10 min before',
      '15 min before',
      '30 min before',
      '1 hour before',
      '4 hours before',
      '1 day before',
    ])
  })

  it('selects the matching option for the per-type default 1440 (1 day)', () => {
    renderReminder(1440)
    expect(selectedReminder()?.textContent?.trim()).toBe('1 day before')
  })

  it('selects the call default 5 minutes before', () => {
    renderReminder(5)
    expect(selectedReminder()?.textContent?.trim()).toBe('5 min before')
  })

  it('renders None for the 0 sentinel', () => {
    renderReminder(0)
    expect(selectedReminder()?.textContent?.trim()).toBe('None')
  })

  it('reports the chosen reminder as minutes', () => {
    const setReminderMinutes = jest.fn()
    renderReminder(15, setReminderMinutes)
    fireEvent.click(screen.getByRole('option', { name: '1 hour before' }))
    expect(setReminderMinutes).toHaveBeenCalledWith(60)
  })
})
