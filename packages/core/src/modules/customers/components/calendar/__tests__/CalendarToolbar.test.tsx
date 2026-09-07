/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { cleanup, fireEvent, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CalendarToolbar } from '../CalendarToolbar'

const EMPTY_FILTERS = { types: [], status: null, ownerUserId: null }

function renderToolbar() {
  return renderWithProviders(
    <CalendarToolbar
      anchor={new Date(2026, 8, 16)}
      search=""
      filters={EMPTY_FILTERS}
      typeOptions={[{ value: 'meeting', label: 'Meeting' }]}
      ownerOptions={[]}
      onAnchorChange={jest.fn()}
      onSearchChange={jest.fn()}
      onFiltersChange={jest.fn()}
    />,
    { locale: 'en' },
  )
}

afterEach(() => {
  cleanup()
})

describe('CalendarToolbar', () => {
  it('stands search and filter at one height', () => {
    // At `size="sm"` the buttons beside the search field are 32px and an
    // IconButton is 28px — three heights on one row. Everything on the scope
    // row is 36px, which is each primitive's default and `lg` on IconButton.
    // Settings is asserted on the scope bar, which is where it now lives.
    const { container } = renderToolbar()
    const search = container.querySelector('[data-slot="search-input-wrapper"]') as HTMLElement
    const buttons = Array.from(container.querySelectorAll('button'))

    expect(search).not.toBeNull()
    expect(search.className).toMatch(/\bh-9\b/)
    expect(buttons.length).toBeGreaterThanOrEqual(1)
    for (const button of buttons) {
      expect(button.className).toMatch(/\b(h-9|size-9)\b/)
      expect(button.className).not.toMatch(/\b(size-6|size-7|size-8|h-7|h-8|h-10|h-11)\b/)
    }
  })

  it('stands the filter popover\'s own controls at that same height', () => {
    // The popover is a second surface, but it is still made of the same box
    // controls, so it answers to the same 36px rule. `Checkbox` is the one
    // thing that cannot: its scale tops out at 20px (`md`), so a type filter is
    // asserted to be at that maximum rather than at the chrome height.
    const { getByRole } = renderToolbar()
    fireEvent.click(getByRole('button', { name: 'Filter' }))

    const popover = within(document.body).getByRole('dialog')
    const boxes = [
      ...Array.from(popover.querySelectorAll('[data-slot="select-trigger"]')),
      ...Array.from(popover.querySelectorAll('button')).filter(
        (node) => node.getAttribute('data-slot') !== 'select-trigger' && node.role !== 'checkbox',
      ),
    ]

    expect(boxes.length).toBeGreaterThanOrEqual(3)
    for (const box of boxes) {
      expect(box.className).toMatch(/\b(h-9|size-9)\b/)
      expect(box.className).not.toMatch(/\b(size-6|size-7|size-8|h-7|h-8|h-10|h-11)\b/)
    }

    const checkbox = popover.querySelector('[role="checkbox"]') as HTMLElement
    expect(checkbox.className).toMatch(/\bsize-5\b/)
  })

  it('gives the search field a width floor it cannot be squeezed below', () => {
    // Regression guard for TC-CAL-004. The magnifier and the clear button are
    // `shrink-0`; the `<input>` is the only flexible thing in the box. With
    // `min-w-0` on the wrapper, typing a value added the clear button, the row
    // ran out of room, and the input shrank to 0px — Playwright reported the
    // search box as "not visible" and `fill()` timed out.
    const { container } = renderToolbar()
    const wrapper = container.querySelector('[data-slot="search-input-wrapper"]')!
      .parentElement as HTMLElement

    expect(wrapper.className).toMatch(/\bmin-w-40\b/)
    expect(wrapper.className).not.toMatch(/\bmin-w-0\b/)
    // The cluster itself must not be shrinkable below its content either, or
    // the floor above just makes the field overflow instead of collapse.
    expect((wrapper.parentElement as HTMLElement).className).not.toMatch(/\bmin-w-0\b/)
  })

  it('keeps the search input addressable by the test hook the specs fill', () => {
    const { container } = renderToolbar()
    expect(container.querySelectorAll('[data-calendar-search]')).toHaveLength(1)
  })

  it('names the search field for assistive tech', () => {
    // Asserted by role rather than the literal string: this harness has no
    // module dictionary, so the code fallback renders here while the app shows
    // the translated `customers.calendar.toolbar.searchPlaceholder`.
    const { getByRole } = renderToolbar()
    const search = getByRole('searchbox')
    expect(search.getAttribute('aria-label')).toBeTruthy()
  })
})
