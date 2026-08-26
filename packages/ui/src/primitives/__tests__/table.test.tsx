/** @jest-environment jsdom */

import * as React from 'react'
import { render } from '@testing-library/react'

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableSortLabel,
  tableAriaSort,
} from '../table'

describe('Table primitive (Phase B.6 polish)', () => {
  it('renders a <table> with data-slot attributes for each slot', () => {
    const { container } = render(
      <Table>
        <TableCaption>Members directory</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Jan</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>1 member</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    )
    expect(container.querySelector('[data-slot="table"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="table-caption"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="table-header"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="table-body"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="table-footer"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-slot="table-row"]').length).toBe(3)
    expect(container.querySelector('[data-slot="table-head"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="table-cell"]')).not.toBeNull()
  })

  it('TableHeader gets the table-header strip', () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Col</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    )
    const head = container.querySelector('[data-slot="table-header"]') as HTMLElement
    expect(head.className).toContain('bg-table-header')
  })

  it('TableFooter gets bordered top + table-header strip', () => {
    const { container } = render(
      <Table>
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    )
    const footer = container.querySelector('[data-slot="table-footer"]') as HTMLElement
    expect(footer.className).toContain('border-t')
    expect(footer.className).toContain('bg-table-header/70')
    expect(footer.className).toContain('font-medium')
  })

  it('TableRow gets the row-hover wash by default + border-b last:border-b-0', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const row = container.querySelector('tbody [data-slot="table-row"]') as HTMLElement
    expect(row.className).toContain('hover:bg-table-row-hover')
    expect(row.className).toContain('border-b')
    expect(row.className).toContain('last:border-b-0')
    expect(row.className).toContain('transition-colors')
  })

  it('Striped variant adds an even-row tint via context', () => {
    const { container } = render(
      <Table variant="striped">
        <TableBody>
          <TableRow>
            <TableCell>1</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>2</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const root = container.querySelector('[data-slot="table"]') as HTMLElement
    expect(root.getAttribute('data-variant')).toBe('striped')
    const rows = Array.from(
      container.querySelectorAll('tbody [data-slot="table-row"]'),
    ) as HTMLElement[]
    expect(rows.length).toBe(2)
    for (const row of rows) {
      expect(row.className).toContain('even:bg-surface-muted/40')
    }
  })

  it('Default variant data-variant attribute reads "default"', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const root = container.querySelector('[data-slot="table"]') as HTMLElement
    expect(root.getAttribute('data-variant')).toBe('default')
    const row = container.querySelector('tbody [data-slot="table-row"]') as HTMLElement
    expect(row.className).not.toContain('even:bg-surface-muted/40')
  })

  it('TableHead renders the scan-first uppercase micro-label', () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Header</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    )
    const head = container.querySelector('[data-slot="table-head"]') as HTMLElement
    expect(head.className).toContain('text-muted-foreground')
    expect(head.className).toContain('text-xs')
    expect(head.className).toContain('font-bold')
    expect(head.className).toContain('uppercase')
    expect(head.className).toContain('tracking-wide')
    expect(head.className).toContain('whitespace-nowrap')
    expect(head.className).toContain('px-3')
    expect(head.className).toContain('sm:px-5')
    expect(head.className).toContain('py-3')
  })

  it('TableCell renders the roomy row height with medium-weight data', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const cell = container.querySelector('[data-slot="table-cell"]') as HTMLElement
    expect(cell.className).toContain('px-3')
    expect(cell.className).toContain('sm:px-5')
    expect(cell.className).toContain('py-4')
    expect(cell.className).toContain('text-sm')
    expect(cell.className).toContain('font-medium')
  })

  it('the header rule sits on the cell, not the row, so it survives a sticky header', () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Header</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    )
    const head = container.querySelector('[data-slot="table-head"]') as HTMLElement
    expect(head.className).toContain('border-b')
    expect(head.className).toContain('border-table-border')
    const strip = container.querySelector('[data-slot="table-header"]') as HTMLElement
    expect(strip.className).not.toContain('[&_tr]:border-b')
  })

  it('TableHead is announced as a column header', () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Header</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    )
    const head = container.querySelector('[data-slot="table-head"]') as HTMLElement
    expect(head.getAttribute('scope')).toBe('col')
  })

  it('align moves the header and its column of cells together', () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead align="right">Amount</TableHead>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell align="right">$10.00</TableCell>
            <TableCell>Jan</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const heads = Array.from(container.querySelectorAll('[data-slot="table-head"]')) as HTMLElement[]
    const cells = Array.from(container.querySelectorAll('[data-slot="table-cell"]')) as HTMLElement[]
    expect(heads[0].getAttribute('data-align')).toBe('right')
    expect(heads[0].className).toContain('text-right')
    expect(cells[0].getAttribute('data-align')).toBe('right')
    expect(cells[0].className).toContain('text-right')
    expect(heads[1].className).toContain('text-left')
    expect(cells[1].className).toContain('text-left')
  })

  it('compact density tightens the cell box and leaves the header design alone', () => {
    const { container } = render(
      <Table density="compact">
        <TableHeader>
          <TableRow>
            <TableHead>Header</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const root = container.querySelector('[data-slot="table"]') as HTMLElement
    expect(root.getAttribute('data-density')).toBe('compact')
    const head = container.querySelector('[data-slot="table-head"]') as HTMLElement
    const cell = container.querySelector('[data-slot="table-cell"]') as HTMLElement
    expect(head.className).toContain('py-2')
    expect(head.className).not.toContain('sm:px-5')
    expect(cell.className).toContain('py-2')
    // typography is the part that must NOT change with density
    expect(head.className).toContain('font-bold')
    expect(head.className).toContain('uppercase')
  })

  it('gives a control column an equal gutter either side instead of reading padding', () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead padding="control">Pick</TableHead>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell padding="control">x</TableCell>
            <TableCell>Jan</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const [control, text] = Array.from(
      container.querySelectorAll('[data-slot="table-head"]'),
    ) as HTMLElement[]
    // Symmetric and tight, shrinking to the control it holds…
    expect(control.className).toContain('px-3')
    expect(control.className).toContain('w-px')
    expect(control.className).not.toContain('sm:px-5')
    // …while the reading column keeps the wider responsive inset.
    expect(text.className).toContain('sm:px-5')
    // Row rhythm is untouched, so both cells are exactly as tall as each other.
    expect(control.className).toContain('py-3')
    expect(text.className).toContain('py-3')

    const [controlCell, textCell] = Array.from(
      container.querySelectorAll('[data-slot="table-cell"]'),
    ) as HTMLElement[]
    expect(controlCell.className).toContain('w-px')
    expect(controlCell.className).toContain('py-4')
    expect(textCell.className).toContain('py-4')
  })

  it('supports the three column alignments through one prop', () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>L</TableHead>
            <TableHead align="center">C</TableHead>
            <TableHead align="right">R</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    )
    const heads = Array.from(container.querySelectorAll('[data-slot="table-head"]')) as HTMLElement[]
    expect(heads.map((el) => el.getAttribute('data-align'))).toEqual(['left', 'center', 'right'])
    expect(heads[0].className).toContain('text-left')
    expect(heads[1].className).toContain('text-center')
    expect(heads[2].className).toContain('text-right')
  })

  it('states vertical centring on both head and cell rather than inheriting it', () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Jan</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    expect((container.querySelector('[data-slot="table-head"]') as HTMLElement).className).toContain('align-middle')
    expect((container.querySelector('[data-slot="table-cell"]') as HTMLElement).className).toContain('align-middle')
  })

  it('keeps the header inset identical to the cell inset beneath it', () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Jan</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const head = container.querySelector('[data-slot="table-head"]') as HTMLElement
    const cell = container.querySelector('[data-slot="table-cell"]') as HTMLElement
    // A label that does not start where its own column of values starts is the
    // most visible way a table reads as misaligned.
    for (const inset of ['px-3', 'sm:px-5']) {
      expect(head.className).toContain(inset)
      expect(cell.className).toContain(inset)
    }
  })

  describe('TableSortLabel', () => {
    it('maps every direction to the right aria-sort value', () => {
      expect(tableAriaSort('asc')).toBe('ascending')
      expect(tableAriaSort('desc')).toBe('descending')
      expect(tableAriaSort(false)).toBe('none')
    })

    it('lifts the label to full ink only while its column is the active sort', () => {
      // Match the bare token, not the substring: `hover:text-foreground` is
      // present in every state and would mask the difference.
      const tokens = (el: HTMLElement) => el.className.split(/\s+/)
      const { container, rerender } = render(<TableSortLabel>Name</TableSortLabel>)
      const idle = container.querySelector('[data-slot="table-sort-label"]') as HTMLElement
      expect(idle.getAttribute('data-direction')).toBe('none')
      expect(tokens(idle)).not.toContain('text-foreground')
      expect(tokens(idle)).toContain('hover:text-foreground')

      rerender(<TableSortLabel direction="asc">Name</TableSortLabel>)
      const active = container.querySelector('[data-slot="table-sort-label"]') as HTMLElement
      expect(active.getAttribute('data-direction')).toBe('asc')
      expect(tokens(active)).toContain('text-foreground')
    })

    it('keeps the indicator the same size in every state so the label never shifts', () => {
      const sizes = (['asc', 'desc', false] as const).map((direction) => {
        const { container, unmount } = render(
          <TableSortLabel direction={direction}>Name</TableSortLabel>,
        )
        const icon = container.querySelector('svg') as SVGElement
        const className = icon.getAttribute('class') ?? ''
        unmount()
        return className
      })
      for (const className of sizes) {
        expect(className).toContain('size-3.5')
        expect(className).toContain('shrink-0')
      }
    })

    it('is a non-submitting button that reports its toggle', () => {
      const onToggle = jest.fn()
      const { container } = render(
        <TableSortLabel direction={false} onToggle={onToggle}>Name</TableSortLabel>,
      )
      const button = container.querySelector('[data-slot="table-sort-label"]') as HTMLButtonElement
      expect(button.getAttribute('type')).toBe('button')
      button.click()
      expect(onToggle).toHaveBeenCalledTimes(1)
    })
  })

  it('forwards className on every slot', () => {
    const { container } = render(
      <Table className="t-custom">
        <TableCaption className="cap-custom">cap</TableCaption>
        <TableHeader className="head-custom">
          <TableRow className="row-custom">
            <TableHead className="th-custom">x</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="body-custom">
          <TableRow>
            <TableCell className="cell-custom">x</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter className="foot-custom">
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    )
    expect(container.querySelector('[data-slot="table"]')!.className).toContain('t-custom')
    expect(container.querySelector('[data-slot="table-caption"]')!.className).toContain('cap-custom')
    expect(container.querySelector('[data-slot="table-header"]')!.className).toContain('head-custom')
    expect(container.querySelector('[data-slot="table-row"]')!.className).toContain('row-custom')
    expect(container.querySelector('[data-slot="table-head"]')!.className).toContain('th-custom')
    expect(container.querySelector('[data-slot="table-body"]')!.className).toContain('body-custom')
    expect(container.querySelector('[data-slot="table-cell"]')!.className).toContain('cell-custom')
    expect(container.querySelector('[data-slot="table-footer"]')!.className).toContain('foot-custom')
  })
})
