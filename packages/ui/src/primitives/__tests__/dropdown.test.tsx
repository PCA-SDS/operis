/** @jest-environment jsdom */

import * as React from 'react'
import { render, fireEvent, within } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { Dropdown, type DropdownOption } from '../dropdown'

const STATUSES: DropdownOption<string>[] = [
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'closed', label: 'Closed', keywords: ['done', 'resolved'] },
]

function renderWithI18n(ui: React.ReactElement) {
  return render(
    <I18nProvider locale="en" dict={{}}>
      {ui}
    </I18nProvider>,
  )
}

function Single({
  onChange,
  ...rest
}: Partial<React.ComponentProps<typeof Dropdown<string>>> & { onChange?: (next: string | null) => void }) {
  const [value, setValue] = React.useState<string | null>(null)
  return (
    <Dropdown<string>
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
      options={STATUSES}
      placeholder="Status"
      {...rest}
    />
  )
}

function Multi({ onMultiChange }: { onMultiChange?: (next: string[]) => void }) {
  const [values, setValues] = React.useState<string[]>([])
  return (
    <Dropdown<string>
      multiValues={values}
      onMultiChange={(next) => {
        setValues(next)
        onMultiChange?.(next)
      }}
      options={STATUSES}
      placeholder="Statuses"
    />
  )
}

const trigger = () => document.querySelector('[data-slot="dropdown-trigger"]') as HTMLButtonElement
const menu = () => document.querySelector('[data-slot="dropdown-menu"]') as HTMLElement | null
const isOpen = () => trigger().getAttribute('aria-expanded') === 'true'

describe('Dropdown', () => {
  it('renders a closed trigger showing the placeholder', () => {
    renderWithI18n(<Single />)
    expect(trigger()).not.toBeNull()
    expect(trigger().textContent).toContain('Status')
    expect(isOpen()).toBe(false)
    expect(menu()).toBeNull()
  })

  it('opens on click and renders the options in a listbox', () => {
    renderWithI18n(<Single />)
    fireEvent.click(trigger())
    expect(isOpen()).toBe(true)
    const listbox = document.querySelector('[role="listbox"]') as HTMLElement
    expect(listbox).not.toBeNull()
    expect(within(listbox).getAllByRole('option')).toHaveLength(3)
  })

  it('portals the menu to document.body so no ancestor can clip it', () => {
    // The whole point of the portal: an `overflow: hidden` table cell or a
    // transformed drawer must not be able to cut the menu off.
    const { container } = renderWithI18n(<Single />)
    fireEvent.click(trigger())
    expect(menu()).not.toBeNull()
    expect(container.contains(menu())).toBe(false)
    expect(document.body.contains(menu())).toBe(true)
  })

  it('selects an option, reports it, and closes', () => {
    const onChange = jest.fn()
    renderWithI18n(<Single onChange={onChange} />)
    fireEvent.click(trigger())
    fireEvent.click(document.querySelectorAll('[role="option"]')[1])
    expect(onChange).toHaveBeenCalledWith('pending')
    expect(isOpen()).toBe(false)
    expect(trigger().textContent).toContain('Pending')
  })

  it('marks the selected option with aria-selected', () => {
    renderWithI18n(<Single />)
    fireEvent.click(trigger())
    fireEvent.click(document.querySelectorAll('[role="option"]')[0])
    fireEvent.click(trigger())
    const options = document.querySelectorAll('[role="option"]')
    expect(options[0].getAttribute('aria-selected')).toBe('true')
    expect(options[1].getAttribute('aria-selected')).toBe('false')
  })

  it('stays open while toggling values in multi-select', () => {
    const onMultiChange = jest.fn()
    renderWithI18n(<Multi onMultiChange={onMultiChange} />)
    fireEvent.click(trigger())
    fireEvent.click(document.querySelectorAll('[role="option"]')[0])
    expect(onMultiChange).toHaveBeenCalledWith(['open'])
    expect(isOpen()).toBe(true)

    fireEvent.click(document.querySelectorAll('[role="option"]')[2])
    expect(onMultiChange).toHaveBeenLastCalledWith(['open', 'closed'])
    expect(isOpen()).toBe(true)
  })

  it('deselects an already-selected value in multi-select', () => {
    const onMultiChange = jest.fn()
    renderWithI18n(<Multi onMultiChange={onMultiChange} />)
    fireEvent.click(trigger())
    fireEvent.click(document.querySelectorAll('[role="option"]')[0])
    fireEvent.click(document.querySelectorAll('[role="option"]')[0])
    expect(onMultiChange).toHaveBeenLastCalledWith([])
  })

  it('marks the listbox multiselectable only in multi mode', () => {
    const { unmount } = renderWithI18n(<Multi />)
    fireEvent.click(trigger())
    expect(document.querySelector('[role="listbox"]')!.getAttribute('aria-multiselectable')).toBe('true')
    unmount()

    renderWithI18n(<Single />)
    fireEvent.click(trigger())
    expect(document.querySelector('[role="listbox"]')!.getAttribute('aria-multiselectable')).toBeNull()
  })

  it('filters options by label and by keyword when searchable', () => {
    renderWithI18n(<Single searchable="Search…" />)
    fireEvent.click(trigger())
    const input = document.querySelector('[role="combobox"]') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'pend' } })
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1)

    // 'resolved' is only a keyword on Closed, never visible text.
    fireEvent.change(input, { target: { value: 'resolved' } })
    const options = document.querySelectorAll('[role="option"]')
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toContain('Closed')
  })

  it('shows the empty-result message when nothing matches', () => {
    renderWithI18n(<Single searchable noResultsLabel="Nothing here" />)
    fireEvent.click(trigger())
    fireEvent.change(document.querySelector('[role="combobox"]') as HTMLInputElement, {
      target: { value: 'zzzz' },
    })
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0)
    expect(menu()!.textContent).toContain('Nothing here')
  })

  it('renders grouped options under their group labels', () => {
    renderWithI18n(
      <Dropdown<string>
        value={null}
        onChange={() => {}}
        placeholder="Currency"
        groups={[
          { label: 'Europe', options: [{ value: 'eur', label: 'Euro' }] },
          { label: 'Americas', options: [{ value: 'usd', label: 'US Dollar' }] },
        ]}
      />,
    )
    fireEvent.click(trigger())
    const groups = document.querySelectorAll('[role="group"]')
    expect(groups).toHaveLength(2)
    expect(groups[0].getAttribute('aria-label')).toBe('Europe')
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2)
  })

  it('opens with ArrowDown and selects the active option with Enter', () => {
    const onChange = jest.fn()
    renderWithI18n(<Single onChange={onChange} />)
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    expect(isOpen()).toBe(true)

    fireEvent.keyDown(menu()!, { key: 'ArrowDown' })
    fireEvent.keyDown(menu()!, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('pending')
  })

  it('jumps to the last option with End', () => {
    const onChange = jest.fn()
    renderWithI18n(<Single onChange={onChange} />)
    fireEvent.click(trigger())
    fireEvent.keyDown(menu()!, { key: 'End' })
    fireEvent.keyDown(menu()!, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('closed')
  })

  it('closes on Escape and returns focus to the trigger', () => {
    renderWithI18n(<Single />)
    fireEvent.click(trigger())
    expect(isOpen()).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(isOpen()).toBe(false)
    expect(document.activeElement).toBe(trigger())
  })

  it('closes when pointing outside the trigger and menu', () => {
    renderWithI18n(<Single />)
    fireEvent.click(trigger())
    fireEvent.pointerDown(document.body)
    expect(isOpen()).toBe(false)
  })

  it('does not open while disabled', () => {
    renderWithI18n(<Single disabled disabledReason="Pick a tenant first" />)
    expect(trigger().disabled).toBe(true)
    fireEvent.click(trigger())
    expect(isOpen()).toBe(false)
    expect(trigger().getAttribute('title')).toBe('Pick a tenant first')
  })

  it('clears the value through the reset row', () => {
    const onChange = jest.fn()
    renderWithI18n(<Single onChange={onChange} resetLabel="All statuses" />)
    fireEvent.click(trigger())
    fireEvent.click(document.querySelectorAll('[role="option"]')[0])
    expect(trigger().textContent).toContain('Open')

    fireEvent.click(trigger())
    const reset = within(menu()!).getByText('All statuses')
    fireEvent.click(reset)
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('offers a create row for a query that matches no option', () => {
    const onCreate = jest.fn()
    renderWithI18n(<Single searchable createOption={{ onCreate }} />)
    fireEvent.click(trigger())
    fireEvent.change(document.querySelector('[role="combobox"]') as HTMLInputElement, {
      target: { value: 'Escalated' },
    })
    const create = within(menu()!).getByText(/Create/)
    fireEvent.click(create)
    expect(onCreate).toHaveBeenCalledWith('Escalated')
  })

  it('does not offer to create a value that already exists', () => {
    renderWithI18n(<Single searchable createOption={{ onCreate: jest.fn() }} />)
    fireEvent.click(trigger())
    fireEvent.change(document.querySelector('[role="combobox"]') as HTMLInputElement, {
      target: { value: 'Open' },
    })
    expect(within(menu()!).queryByText(/Create/)).toBeNull()
  })

  it('runs a command row and closes', () => {
    const onSelect = jest.fn()
    renderWithI18n(<Single actions={[{ label: 'Manage statuses', onSelect }]} />)
    fireEvent.click(trigger())
    fireEvent.click(within(menu()!).getByText('Manage statuses'))
    expect(onSelect).toHaveBeenCalled()
    expect(isOpen()).toBe(false)
  })

  it('reports the count instead of a list once several values are selected', () => {
    renderWithI18n(<Multi />)
    fireEvent.click(trigger())
    fireEvent.click(document.querySelectorAll('[role="option"]')[0])
    fireEvent.click(document.querySelectorAll('[role="option"]')[1])
    expect(trigger().textContent).toContain('2 selected')
  })

  it('renders the loading label and blocks opening while loading', () => {
    renderWithI18n(<Single isLoading loadingLabel="Fetching…" />)
    expect(trigger().textContent).toContain('Fetching…')
    expect(trigger().disabled).toBe(true)
  })

  it('shows the empty label when there are no options at all', () => {
    renderWithI18n(<Single options={[]} emptyLabel="No statuses yet" />)
    expect(trigger().textContent).toContain('No statuses yet')
    expect(trigger().disabled).toBe(true)
  })
})

describe('Dropdown menu mode', () => {
  const commands = [
    { label: 'Edit', onSelect: jest.fn() },
    { label: 'Delete', destructive: true, onSelect: jest.fn() },
  ]

  it('announces a menu of commands rather than a listbox of values', () => {
    renderWithI18n(<Dropdown<string> menu actions={commands} placeholder="Actions" />)
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu')
    fireEvent.click(trigger())
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(2)
  })

  it('does not leave an empty listbox behind when there are no values', () => {
    // A menu carries no options; an empty listbox would still be announced.
    renderWithI18n(<Dropdown<string> menu actions={commands} placeholder="Actions" />)
    fireEvent.click(trigger())
    expect(document.querySelector('[role="listbox"]:not([hidden])')).toBeNull()
  })

  it('keeps listbox semantics when it is not a menu', () => {
    renderWithI18n(<Single />)
    expect(trigger()).toHaveAttribute('aria-haspopup', 'listbox')
    fireEvent.click(trigger())
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()
  })

  it('renders a group description under its heading', () => {
    renderWithI18n(
      <Dropdown<string>
        placeholder="Export"
        groups={[
          { label: 'Export view', description: 'Only the rows you can see', options: [{ value: 'csv', label: 'CSV' }] },
        ]}
      />,
    )
    fireEvent.click(trigger())
    expect(within(menu()!).getByText('Only the rows you can see')).toBeInTheDocument()
  })

  it('puts command rows in a list, never loose <li> in a <div>', () => {
    renderWithI18n(<Dropdown<string> menu actions={commands} placeholder="Actions" />)
    fireEvent.click(trigger())
    const item = document.querySelector('[role="menuitem"]') as HTMLElement
    expect(item.closest('li')?.parentElement?.tagName).toBe('UL')
  })
})
