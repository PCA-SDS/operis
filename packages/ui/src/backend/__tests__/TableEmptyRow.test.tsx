/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { Table, TableBody } from '../../primitives/table'
import { TableEmptyRow } from '../TableEmptyRow'

function renderRow(props: Partial<React.ComponentProps<typeof TableEmptyRow>> = {}) {
  return render(
    <Table>
      <TableBody>
        <TableEmptyRow colSpan={4} title="No entries yet." {...props} />
      </TableBody>
    </Table>,
  )
}

afterEach(() => {
  cleanup()
})

describe('TableEmptyRow', () => {
  it('spans every column, so the state centres under the whole table', () => {
    // The Table primitive is a CSS grid of divs, so colSpan becomes a
    // grid-column span rather than a colspan attribute. Spanning at least the
    // column count collapses to the full-width `1 / -1`.
    const { container } = renderRow({ colSpan: 7 })
    const cell = container.querySelector('[role="cell"]') as HTMLElement
    expect(cell.style.gridColumn).toBe('1 / -1')
  })

  it('stays inside the grid as a row and cell, keeping the column geometry', () => {
    const { container } = renderRow()
    const cell = container.querySelector('[role="rowgroup"] > [role="row"] > [role="cell"]')
    expect(cell).not.toBeNull()
  })

  it('announces politely by default', () => {
    renderRow()
    expect(screen.getByRole('status')).toHaveTextContent('No entries yet.')
  })

  it('announces assertively when the row reports a failure', () => {
    renderRow({ tone: 'error', title: 'Could not load entries.' })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load entries.')
  })

  it('carries the same subtle treatment DataTable uses, not the dashed card', () => {
    // The surrounding table already draws the border; the standalone card's
    // dashed frame would double it.
    const { container } = renderRow()
    const state = container.querySelector('[data-slot="empty-state"]')!
    expect(state.className).not.toMatch(/border-dashed/)
  })

  it('renders a description and actions when given them', () => {
    renderRow({ description: 'Add one to get started.', actions: <button type="button">Add</button> })
    expect(screen.getByText('Add one to get started.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })
})
