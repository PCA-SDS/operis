/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { cleanup, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CalendarScopeBar } from '../CalendarScopeBar'

const COUNTS = { all: 4, meetings: 0, events: 4 }

function renderScopeBar(overrides: { onOpenSettings?: () => void } = {}) {
  return renderWithProviders(
    <CalendarScopeBar
      tab="all"
      counts={COUNTS}
      range={{ from: new Date(2026, 7, 31), to: new Date(2026, 8, 6) }}
      anchor={new Date(2026, 7, 31)}
      preset="thisWeek"
      onTabChange={jest.fn()}
      onPresetChange={jest.fn()}
      onAnchorChange={jest.fn()}
      onOpenSettings={overrides.onOpenSettings ?? jest.fn()}
    />,
    { locale: 'en' },
  )
}

afterEach(() => {
  cleanup()
})

describe('CalendarScopeBar', () => {
  it('stands the category rail, the preset select and the range button at one height', () => {
    // The preset trigger and the range button render as one joined pair, so a
    // size mismatch between them shows up as a visible step in the seam rather
    // than as two separate controls that happen to differ.
    const { container } = renderScopeBar()
    const rail = container.querySelector('[data-slot="segmented-control"]') as HTMLElement
    const preset = container.querySelector('[data-slot="select-trigger"]') as HTMLElement
    // A segmented item is a `<button>` that deliberately carries no height of
    // its own — the track owns the box and the items stretch into it, which is
    // what keeps the sliding pill inset by the same 2px on all four sides.
    const standalone = Array.from(container.querySelectorAll('button')).filter(
      (node) => !node.closest('[data-slot="segmented-control"]'),
    )
    const controls = [rail, preset, ...standalone]

    expect(standalone.length).toBeGreaterThanOrEqual(1)
    for (const control of controls) {
      expect(control).not.toBeNull()
      expect(control.className).toMatch(/\b(h-9|size-9)\b/)
      expect(control.className).not.toMatch(/\b(size-6|size-7|size-8|h-7|h-8|h-10|h-11)\b/)
    }
  })

  it('renders the trailing slot on the same row as the range controls', () => {
    const { getByTestId } = renderWithProviders(
      <CalendarScopeBar
        tab="all"
        counts={COUNTS}
        range={{ from: new Date(2026, 7, 31), to: new Date(2026, 8, 6) }}
        anchor={new Date(2026, 7, 31)}
        preset="thisWeek"
        trailing={<span data-testid="scope-trailing">search</span>}
        onTabChange={jest.fn()}
        onPresetChange={jest.fn()}
        onAnchorChange={jest.fn()}
      />,
      { locale: 'en' },
    )

    expect(getByTestId('scope-trailing')).not.toBeNull()
  })

  it('closes the row with settings, past the date range', () => {
    // Settings is the one control here that does not narrow what the grid
    // shows, so it belongs at the end rather than among the filters. It used to
    // render inside the toolbar's trailing slot, which put it before the range
    // preset and the date button.
    const onOpenSettings = jest.fn()
    const { container, getByRole } = renderScopeBar({ onOpenSettings })
    const settings = getByRole('button', { name: 'Calendar settings' })

    const controls = Array.from(container.querySelectorAll('button'))
    expect(controls[controls.length - 1]).toBe(settings)

    fireEvent.click(settings)
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })
})
