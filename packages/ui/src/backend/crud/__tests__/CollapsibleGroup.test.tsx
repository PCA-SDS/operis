/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CollapsibleGroup } from '../CollapsibleGroup'
import { SortableGroupHandleProvider, type SortableGroupHandleProps } from '../SortableGroupHandle'

const handleProps: SortableGroupHandleProps = {
  ref: () => {},
  attributes: { role: 'button', tabIndex: 0 },
  listeners: {},
  isDragging: false,
  disabled: false,
}

describe('CollapsibleGroup tone="card"', () => {
  beforeEach(() => localStorage.clear())

  it('is a card whose header is the title and a disclosure chevron, with no field count', async () => {
    renderWithProviders(
      <SortableGroupHandleProvider value={handleProps}>
        <CollapsibleGroup groupId="identity" title="Identity" pageType="card-test" tone="card" fieldCount={3}>
          <input aria-label="Name" />
        </CollapsibleGroup>
      </SortableGroupHandleProvider>,
      { dict: {} },
    )

    const header = await screen.findByRole('button', { name: 'Identity' })
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByText(/fields?/)).toBeNull()

    // The reorder handle is there for pointer and keyboard, but waits out of sight.
    const handle = screen.getByRole('button', { name: 'Drag to reorder' })
    expect(handle.className).toContain('opacity-0')
    expect(handle.className).toContain('group-hover/group-header:opacity-100')
    expect(handle.className).toContain('focus-visible:opacity-100')

    const card = document.getElementById('collapsible-group-wrapper-identity') as HTMLElement
    expect(card).toHaveAttribute('data-tone', 'card')
    expect(card.className).toContain('bg-surface')

    fireEvent.click(header)
    await waitFor(() => expect(header).toHaveAttribute('aria-expanded', 'false'))
    expect(document.getElementById('collapsible-group-identity')).toHaveAttribute('inert')
  })

  it('outlines the card and counts the errors when a field is invalid', async () => {
    renderWithProviders(
      <CollapsibleGroup groupId="contact" title="Contact" pageType="card-test" tone="card" errorCount={2}>
        <input aria-label="Email" />
      </CollapsibleGroup>,
      { dict: {} },
    )
    await screen.findByRole('button', { name: /Contact/ })
    const card = document.getElementById('collapsible-group-wrapper-contact') as HTMLElement
    expect(card.className).toContain('border-destructive')
    expect(screen.getByText('2 errors')).toBeInTheDocument()
  })
})
