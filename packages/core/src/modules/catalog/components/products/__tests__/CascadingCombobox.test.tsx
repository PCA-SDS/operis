/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { calculateDropdownPosition, CascadingCombobox, type CascadingItemDef } from '../CascadingCombobox'
import { useIsMobile } from '@open-mercato/ui/hooks/useIsMobile'

jest.mock('@open-mercato/ui/hooks/useIsMobile', () => ({
  useIsMobile: jest.fn(),
}))

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
  beforeEach(() => {
    ;(useIsMobile as jest.Mock).mockReturnValue(false)
  })

  it('opens above the trigger and clamps the desktop list to available viewport space', () => {
    expect(calculateDropdownPosition(
      { top: 500, bottom: 540, left: 100, width: 360 },
      { innerWidth: 1200, innerHeight: 600 },
    )).toEqual({ top: undefined, bottom: 104, left: 100, width: 360, maxHeight: 256 })
  })

  it('keeps the desktop dropdown within the viewport near the right edge', () => {
    expect(calculateDropdownPosition(
      { top: 40, bottom: 80, left: 1100, width: 400 },
      { innerWidth: 1200, innerHeight: 900 },
    )).toEqual({ top: 84, bottom: undefined, left: 788, width: 400, maxHeight: 256 })
  })

  it('keeps the mobile drawer option list independently scrollable', () => {
    ;(useIsMobile as jest.Mock).mockReturnValue(true)
    render(
      <CascadingCombobox
        value=""
        onChange={jest.fn()}
        items={items}
        placeholder="Search options"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Search options' }))

    expect(document.querySelector('.min-h-0.flex-1.overflow-y-auto')).toBeInTheDocument()
  })

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
