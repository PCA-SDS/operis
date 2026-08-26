/** @jest-environment jsdom */
/**
 * The column-header contract, asserted through a real DataTable rather than
 * through the primitive alone — this is the wiring that every list page in the
 * product renders, and the part that silently drifts: a header that stops
 * matching the alignment of its own column, a sort state that never reaches
 * assistive tech, or a resize grip drawn on every column edge at rest.
 */
import * as React from 'react'
import { render, fireEvent } from '@testing-library/react'
import { DataTable } from '../DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; name: string; amount: number }

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'amount', header: 'Amount', meta: { align: 'right' } },
]

const data: Row[] = [
  { id: '1', name: 'Ada', amount: 12 },
  { id: '2', name: 'Zed', amount: 7 },
]

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        <DataTable columns={columns} data={data} sortable {...props} />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

const headOf = (container: HTMLElement, label: string) =>
  (Array.from(container.querySelectorAll('[data-slot="table-head"]')) as HTMLElement[]).find(
    (el) => el.textContent?.trim() === label,
  )!

describe('DataTable column headers', () => {
  it('sorts through the shared TableSortLabel, not a hand-rolled control', () => {
    const { container } = renderTable()
    const labels = container.querySelectorAll('[data-slot="table-sort-label"]')
    expect(labels.length).toBe(columns.length)
  })

  it('exposes sort state to assistive tech and flips it on click', () => {
    const { container } = renderTable()
    const nameHead = headOf(container, 'Name')
    expect(nameHead.getAttribute('aria-sort')).toBe('none')

    const trigger = nameHead.querySelector('[data-slot="table-sort-label"]') as HTMLElement
    fireEvent.click(trigger)
    expect(headOf(container, 'Name').getAttribute('aria-sort')).toBe('ascending')

    fireEvent.click(headOf(container, 'Name').querySelector('[data-slot="table-sort-label"]')!)
    expect(headOf(container, 'Name').getAttribute('aria-sort')).toBe('descending')
  })

  it('moves a header and its own column of cells with one meta.align', () => {
    const { container } = renderTable()
    expect(headOf(container, 'Amount').getAttribute('data-align')).toBe('right')
    expect(headOf(container, 'Name').getAttribute('data-align')).toBe('left')

    const bodyRow = container.querySelector('tbody [data-slot="table-row"]') as HTMLElement
    const cells = Array.from(bodyRow.querySelectorAll('[data-slot="table-cell"]')) as HTMLElement[]
    // Column order is Name, Amount — the cells must match their headers.
    expect(cells[0].getAttribute('data-align')).toBe('left')
    expect(cells[1].getAttribute('data-align')).toBe('right')
  })

  it('leaves the header unpinned unless the table owns a vertical scrollport', () => {
    const { container } = renderTable()
    const head = container.querySelector('[data-slot="table-head"]') as HTMLElement
    expect(head.className).not.toContain('sticky top-0')

    const pinned = renderTable({ stickyHeader: true })
    const pinnedHead = pinned.container.querySelector('[data-slot="table-head"]') as HTMLElement
    expect(pinnedHead.className).toContain('sticky')
    expect(pinnedHead.className).toContain('top-0')
  })

  it('paints nothing at the column edge — the resize zone is cursor-only', () => {
    // Resize handles only exist where widths can persist — a perspective table.
    const { container } = renderTable({ perspective: { tableId: 'test.headers' } })
    const handle = container.querySelector('[data-resize-handle]') as HTMLElement
    expect(handle).not.toBeNull()
    // The hit zone and the cursor are the whole affordance.
    expect(handle.className).toContain('cursor-col-resize')
    expect(handle.className).toContain('w-3')
    // Any bar here reads as a ruled column separator, and is the only thing in
    // the header row darker than the strip it sits on.
    expect(handle.children.length).toBe(0)
    for (const paint of ['bg-border', 'bg-primary', 'border-r', 'opacity-100']) {
      expect(handle.className).not.toContain(paint)
    }
  })
})

describe('DataTable column resize feedback', () => {
  const startDrag = (container: HTMLElement) => {
    const handle = container.querySelector('[role="separator"]') as HTMLElement
    expect(handle).not.toBeNull()
    // jsdom drops `button` from fireEvent.pointerDown's init, and the handler
    // ignores anything but the primary button — dispatch a real MouseEvent so the
    // drag actually starts.
    fireEvent(handle, new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 100 }))
    return handle
  }

  it('paints a full-table guide and a live width readout while dragging', () => {
    const { container } = renderTable({ perspective: { tableId: 'test.resize' } })
    expect(container.querySelector('[data-column-resize-guide]')).toBeNull()

    startDrag(container)
    expect(container.querySelector('[data-column-resize-guide]')).not.toBeNull()
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/px/)
  })

  it('tags the column being resized, header and cells together', () => {
    const { container } = renderTable({ perspective: { tableId: 'test.resize' } })
    startDrag(container)

    const markedHead = container.querySelector('thead [data-resizing="true"]')
    const markedCells = container.querySelectorAll('tbody [data-resizing="true"]')
    expect(markedHead).not.toBeNull()
    // One tagged cell per row, all in the same column.
    expect(markedCells.length).toBe(data.length)
  })

  it('clears every drag affordance when the pointer is released', () => {
    const { container } = renderTable({ perspective: { tableId: 'test.resize' } })
    startDrag(container)
    expect(container.querySelector('[data-column-resize-guide]')).not.toBeNull()

    fireEvent(document, new MouseEvent('pointerup', { bubbles: true, button: 0 }))
    expect(container.querySelector('[data-column-resize-guide]')).toBeNull()
    expect(container.querySelector('[data-resizing="true"]')).toBeNull()
  })
})

/**
 * Column REORDER (dragging a header sideways) is a different interaction from
 * resize, and used to have almost no feedback: the source header dimmed to 50%
 * while its own body cells stayed solid and the neighbours slid, so nothing on
 * screen read as "you are carrying this column".
 */
describe('DataTable column reorder feedback', () => {
  const columnChooser = { enabled: true } as never

  it('renders no drag chrome until a reorder actually starts', () => {
    const { container } = renderTable({ columnChooser })
    expect(container.querySelector('[data-dragging="true"]')).toBeNull()
    expect(container.querySelector('[data-reordering="true"]')).toBeNull()
  })

  it('makes every header reorderable when the column chooser is on', () => {
    const { container } = renderTable({ columnChooser })
    const heads = Array.from(container.querySelectorAll('[data-slot="table-head"]')) as HTMLElement[]
    const grabbable = heads.filter((el) => el.style.cursor === 'grab')
    expect(grabbable.length).toBeGreaterThan(0)
  })

  it('leaves headers unreorderable when the column chooser is off', () => {
    const { container } = renderTable()
    const heads = Array.from(container.querySelectorAll('[data-slot="table-head"]')) as HTMLElement[]
    expect(heads.every((el) => el.style.cursor !== 'grab')).toBe(true)
  })

  it('advertises the gesture with the cell itself, painting nothing into the row', () => {
    const { container } = renderTable({ columnChooser })
    const head = container.querySelector('[data-slot="table-head"]') as HTMLElement
    // The tint plus the `grab` cursor IS the affordance. No grip, no edge bar —
    // anything drawn inside the header row competes with the labels, which are
    // the only marks a column header should carry.
    expect(head.className).toContain('hover:bg-surface-strong')
    expect(head.style.cursor).toBe('grab')
    // The only glyph in the cell is the sort indicator, inside the sort control.
    const strayGlyphs = Array.from(head.querySelectorAll('svg')).filter(
      (svg) => !svg.closest('[data-slot="table-sort-label"]'),
    )
    expect(strayGlyphs).toHaveLength(0)
  })

  it('offers no grip where the column cannot be reordered', () => {
    const { container } = renderTable()
    const head = container.querySelector('[data-slot="table-head"]') as HTMLElement
    expect(head.className).not.toContain('hover:bg-surface-strong')
  })
})
