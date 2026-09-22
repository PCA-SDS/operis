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
      typeOptions={[{ value: 'meeting', label: 'Meeting' }]}
      onAnchorChange={jest.fn()}
      onSearchChange={jest.fn()}
    />,
    { locale: 'en' },
  )
}

afterEach(() => {
  cleanup()
})

describe('CalendarToolbar', () => {

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
