/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CollapsibleGroup } from '../crud/CollapsibleGroup'

function renderGroup(tone?: 'default' | 'card') {
  const view = renderWithProviders(
    <CollapsibleGroup groupId="identity" title="Identity" pageType="test-page" tone={tone}>
      <span>field</span>
    </CollapsibleGroup>,
    { dict: {} },
  )
  const wrapper = view.container.querySelector('[data-collapsible-group-id="identity"]') as HTMLElement
  return { wrapper }
}

describe('CollapsibleGroup tone', () => {
  beforeEach(() => window.localStorage.clear())

  it('keeps the muted open state by default', () => {
    const { wrapper } = renderGroup()
    expect(wrapper).toHaveAttribute('data-state', 'open')
    expect(wrapper.className).toContain('bg-muted')
  })

  it('stays a white card open and closed with the card tone', () => {
    const { wrapper } = renderGroup('card')
    expect(wrapper.className).toContain('bg-surface')
    expect(wrapper.className).not.toContain('bg-muted')

    fireEvent.click(screen.getByRole('button', { name: /Identity/ }))
    expect(wrapper).toHaveAttribute('data-state', 'closed')
    expect(wrapper.className).toContain('bg-surface')
    expect(wrapper.className).not.toContain('hover:bg-muted')
  })
})
