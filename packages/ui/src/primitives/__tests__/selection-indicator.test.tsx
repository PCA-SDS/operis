/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { SelectionIndicator } from '../selection-indicator'

/**
 * The two roles this mark plays, and why the distinction is load-bearing.
 *
 * In a list whose row is a plain `div`, the indicator IS the control and must
 * carry the checkbox semantics. In a list whose row is already a
 * `<button role="checkbox">`, a second checkbox inside the first would announce
 * the option twice and hand a screen reader two states for one choice — so the
 * indicator goes silent instead.
 */
describe('SelectionIndicator', () => {
  it('is the control when given a label', () => {
    render(<SelectionIndicator checked label="Select Alice" />)
    const box = screen.getByRole('checkbox', { name: 'Select Alice' })
    expect(box.getAttribute('aria-checked')).toBe('true')
  })

  it('reports an unchecked state rather than omitting it', () => {
    render(<SelectionIndicator checked={false} label="Select Alice" />)
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false')
  })

  it('goes silent when the row around it already carries the role', () => {
    const { container } = render(<SelectionIndicator checked />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true')
  })

  it('marks disabled only where it is announced', () => {
    const labelled = render(<SelectionIndicator checked disabled label="Select Alice" />)
    expect(screen.getByRole('checkbox').getAttribute('aria-disabled')).toBe('true')
    labelled.unmount()

    // Presentational: `aria-disabled` on an `aria-hidden` node is noise.
    const { container } = render(<SelectionIndicator checked disabled />)
    expect(container.firstElementChild!.getAttribute('aria-disabled')).toBeNull()
  })

  it('shows a tick only when checked', () => {
    const { container, rerender } = render(<SelectionIndicator checked={false} />)
    expect(container.querySelector('svg')).toBeNull()
    rerender(<SelectionIndicator checked />)
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
