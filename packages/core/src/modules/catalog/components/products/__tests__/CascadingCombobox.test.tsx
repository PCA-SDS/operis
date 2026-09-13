/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { CascadingCombobox, type CascadingItemDef } from '../CascadingCombobox'

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string) => fallback ?? key
  return { useT: () => translate }
})

const items: CascadingItemDef[] = [
  {
    id: 'group-skincare',
    label: 'Skincare',
    selectable: false,
    children: [
      {
        id: 'hydration',
        label: 'Hydration',
        selectable: true,
        children: [
          {
            id: 'deep-collagen-mask',
            label: 'Deep collagen mask',
            description: 'Nested treatment add-on',
            selectable: true,
          },
        ],
      },
    ],
  },
]

describe('CascadingCombobox', () => {
  it('shows deep matching children while searching without requiring manual expansion', () => {
    const onChange = jest.fn()
    render(
      <CascadingCombobox
        value=""
        onChange={onChange}
        items={items}
        placeholder="Search options"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Search options' }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'collagen' } })

    expect(screen.getByText('Skincare')).toBeInTheDocument()
    expect(screen.getByText('Hydration')).toBeInTheDocument()
    expect(screen.getByText('Deep collagen mask')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Deep collagen mask/ }))

    expect(onChange).toHaveBeenCalledWith('deep-collagen-mask')
  })

  it('shows selected item context when labels can repeat', () => {
    const onChange = jest.fn()
    render(
      <CascadingCombobox
        value="deep-collagen-mask"
        onChange={onChange}
        items={items}
        placeholder="Search options"
      />,
    )

    expect(screen.getByText('Deep collagen mask')).toBeInTheDocument()
    expect(screen.getByText('Nested treatment add-on')).toBeInTheDocument()
  })
})
