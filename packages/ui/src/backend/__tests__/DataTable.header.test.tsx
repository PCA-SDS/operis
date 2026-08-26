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

  it('keeps the resize grip out of the resting header so it reads as a label row', () => {
    // Resize handles only exist where widths can persist — a perspective table.
    const { container } = renderTable({ perspective: { tableId: 'test.headers' } })
    const grip = container.querySelector('[role="separator"] span') as HTMLElement
    expect(grip).not.toBeNull()
    expect(grip.className).toContain('opacity-0')
    expect(grip.className).toContain('group-hover:opacity-100')
    // The resting grip is what read as a ruled column separator; it must not be
    // painted until the header cell is hovered.
    expect(grip.className).not.toContain('h-3.5')
  })
})
