/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable } from '../DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { act, render } from '@testing-library/react'
import { RowActions } from '../RowActions'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; title: string; status: string }

const tokensOf = (el: Element | null): string[] =>
  (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)

// Pinned columns must never consume the viewport on phones: an unconditionally
// `sticky` first column (often ~300px wide) plus a sticky actions column can
// exceed a small screen entirely, leaving the middle columns scrolling
// invisibly underneath with no reachable window. Pinning (position, offsets,
// z-index, opaque background, edge shadows) must therefore apply only from the
// `md` breakpoint up, so narrow viewports fall back to the documented plain
// horizontal-scroll behavior where every column can be swiped into view.
describe('DataTable sticky columns are viewport-gated', () => {
  function renderStickyTable() {
    const columns: ColumnDef<Row>[] = [
      { accessorKey: 'title', header: 'Title' },
      { accessorKey: 'status', header: 'Status' },
    ]
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    const result = render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale="en" dict={{}}>
          <DataTable
            columns={columns}
            data={[{ id: '1', title: 'Solar rollout', status: 'open' }]}
            stickyFirstColumn
            stickyActionsColumn
            rowActions={() => (
              <RowActions items={[{ id: 'edit', label: 'Edit', onSelect: () => {} }]} />
            )}
          />
        </I18nProvider>
      </QueryClientProvider>,
    )
    return { ...result, queryClient }
  }

  it('pins the first data column only from md up', () => {
    const { container, queryClient } = renderStickyTable()
    try {
      const headerCells = container.querySelectorAll('thead th')
      const firstHeader = headerCells[0]
      const firstBodyCell = container.querySelector('tbody tr td')

      for (const [cell, fill] of [
        [firstHeader, 'md:bg-table-header'],
        [firstBodyCell, 'md:bg-surface'],
      ] as const) {
        const tokens = tokensOf(cell)
        expect(tokens).toEqual(
          expect.arrayContaining(['md:sticky', 'md:left-0', fill, 'md:after:absolute']),
        )
        expect(tokens).not.toContain('sticky')
        expect(tokens).not.toContain('left-0')
        expect(tokens).not.toContain('bg-background')
        expect(tokens).not.toContain('after:absolute')
      }
    } finally {
      queryClient.clear()
    }
  })

  // The pinned-column shadow is a scroll affordance, not decoration: at
  // scrollLeft 0 nothing is hidden under the pinned edge, so a shadow there
  // reads as an unexplained rule between two ordinary column headers (#header
  // polish). It must stay transparent until the table is actually scrolled.
  it('keeps the pinned-edge shadows transparent until there is something to cover', () => {
    const { container, queryClient } = renderStickyTable()
    try {
      const firstHeader = container.querySelector('thead th')
      const actionsHeader = (() => {
        const cells = container.querySelectorAll('thead th')
        return cells[cells.length - 1]
      })()
      expect(tokensOf(firstHeader)).toContain('md:after:opacity-0')
      expect(tokensOf(firstHeader)).not.toContain('md:after:opacity-100')
      expect(tokensOf(actionsHeader)).toContain('md:before:opacity-0')
      expect(tokensOf(actionsHeader)).not.toContain('md:before:opacity-100')
    } finally {
      queryClient.clear()
    }
  })

  it('fades the left edge in once the table is scrolled away from the start', () => {
    const { container, queryClient } = renderStickyTable()
    try {
      const scrollport = container.querySelector('.overflow-auto') as HTMLElement
      expect(scrollport).not.toBeNull()
      // jsdom reports every layout box as 0, so stand in for a scrolled viewport.
      Object.defineProperty(scrollport, 'scrollWidth', { value: 1200, configurable: true })
      Object.defineProperty(scrollport, 'clientWidth', { value: 600, configurable: true })
      scrollport.scrollLeft = 200

      act(() => {
        scrollport.dispatchEvent(new Event('scroll'))
      })

      const firstHeader = container.querySelector('thead th')
      expect(tokensOf(firstHeader)).toContain('md:after:opacity-100')
      // Still more to scroll, so the right edge stays lit too.
      const cells = container.querySelectorAll('thead th')
      expect(tokensOf(cells[cells.length - 1])).toContain('md:before:opacity-100')

      // Scrolled fully to the end: nothing left hidden on the right.
      scrollport.scrollLeft = 600
      act(() => {
        scrollport.dispatchEvent(new Event('scroll'))
      })
      const after = container.querySelectorAll('thead th')
      expect(tokensOf(after[after.length - 1])).toContain('md:before:opacity-0')
    } finally {
      queryClient.clear()
    }
  })

  it('pins the actions column only from md up', () => {
    const { container, queryClient } = renderStickyTable()
    try {
      const headerCells = container.querySelectorAll('thead th')
      const actionsHeader = headerCells[headerCells.length - 1]
      const actionsBodyCell = container.querySelector('tbody tr td[data-actions-cell]')
      expect(actionsBodyCell).not.toBeNull()

      for (const [cell, fill] of [
        [actionsHeader, 'md:bg-table-header'],
        [actionsBodyCell, 'md:bg-surface'],
      ] as const) {
        const tokens = tokensOf(cell)
        expect(tokens).toEqual(
          expect.arrayContaining(['md:sticky', 'md:right-0', fill, 'md:before:absolute']),
        )
        expect(tokens).not.toContain('sticky')
        expect(tokens).not.toContain('right-0')
        expect(tokens).not.toContain('bg-background')
        expect(tokens).not.toContain('before:absolute')
      }
    } finally {
      queryClient.clear()
    }
  })
})
