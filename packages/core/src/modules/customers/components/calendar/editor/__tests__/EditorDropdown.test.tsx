/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { EditorDropdown } from '../EditorDropdown'

// Floating UI measures its anchor, which jsdom cannot do on its own.
beforeAll(() => {
  if (typeof ResizeObserver === 'undefined') {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

afterEach(cleanup)

const GROUPS = [{ options: [{ value: 'a', label: 'Ada Lovelace' }] }]

/** The chip pickers' shape: a live search field as the trigger, `open` owned by
 *  the caller and pushed back up on focus. */
function Picker({ groups = GROUPS, loading = false }: { groups?: typeof GROUPS; loading?: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  return (
    <EditorDropdown
      open={open}
      onOpenChange={setOpen}
      ariaLabel="Attendees"
      triggerMode="anchor"
      groups={groups}
      loading={loading}
      onSelect={() => {}}
      trigger={
        <SearchInput
          value={query}
          onChange={setQuery}
          onFocus={() => setOpen(true)}
          placeholder="Add an attendee…"
          aria-label="Attendees"
        />
      }
    />
  )
}

describe('EditorDropdown — anchor mode', () => {
  it('wraps the whole field in the anchor rather than handing Radix the inner input', () => {
    const { container } = renderWithProviders(<Picker />, { locale: 'en' })
    const field = container.querySelector('[data-slot="search-input-wrapper"]')
    expect(field).not.toBeNull()

    // `asChild` hands Radix the trigger's forwarded ref, and `SearchInput`
    // forwards to the inner `<input>` — the element between the magnifier and
    // the clear button. The panel then took that element's width and left edge
    // instead of the field's: narrower, shifted right by the glyph, and (the
    // input being centred in the 36px box) overlapping the field's own bottom
    // edge. So the anchor has to be a wrapper the dropdown renders itself,
    // spanning the field. Without it this parent is whatever the caller
    // happened to put the picker in, carrying no width contract at all.
    expect(field!.parentElement).toHaveClass('w-full')
    expect(field!.parentElement!.contains(container.querySelector('input[type="search"]')!)).toBe(true)
  })

  // The other half of this fix — treating a press on the anchor as inside the
  // popover, so the field's own focus handler cannot reopen what Radix just
  // dismissed — is not asserted here on purpose: Radix's dismissable layer does
  // not run under jsdom (an outside `pointerdown` leaves the panel open), so a
  // test for it would pass whether or not the guard exists. It was verified in
  // a browser instead.
})

describe('EditorDropdown — loading', () => {
  it('keeps the rows it already has while the next search is in flight', () => {
    renderWithProviders(<Picker loading />, { locale: 'en' })
    fireEvent.focus(screen.getByLabelText('Attendees', { selector: 'input' }))

    // Replacing the list with "Searching…" on every keystroke emptied and
    // refilled the panel as the user typed.
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.queryByText('Searching…')).toBeNull()
  })

  it('shows the searching hint only when there is nothing under it', () => {
    renderWithProviders(<Picker groups={[{ options: [] }]} loading />, { locale: 'en' })
    fireEvent.focus(screen.getByLabelText('Attendees', { selector: 'input' }))
    expect(screen.getByText('Searching…')).toBeInTheDocument()
    expect(screen.queryByText('No results')).toBeNull()
  })
})
