/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '../DataTable'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))
jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => 0,
  subscribeToInjectionRegistryChanges: () => () => {},
  loadInjectionWidgetsForSpot: jest.fn(async () => []),
  loadInjectionDataWidgetsForSpot: jest.fn(async () => []),
}))
const flashMock = jest.fn()
jest.mock('../FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))

type Row = { id: string; name: string }
const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]
const ROWS: Row[] = [{ id: '1', name: 'Ada' }, { id: '2', name: 'Grace' }]

function renderTable(props: Record<string, unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } })
  const ui = (p: Record<string, unknown>) => (
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        {React.createElement(DataTable as any, { columns, ...p })}
      </I18nProvider>
    </QueryClientProvider>
  )
  const result = render(ui(props))
  return { ...result, rerenderWith: (p: Record<string, unknown>) => result.rerender(ui(p)), queryClient }
}

function tbody() {
  return document.querySelector('[data-slot="table-body"]') as HTMLElement
}

describe('DataTable — refetch keeps rows instead of erasing them', () => {
  beforeEach(() => { flashMock.mockReset() })

  it('shows the spinner row on a genuine first load (no rows yet)', () => {
    renderTable({ data: [], isLoading: true })
    expect(screen.getByText('Loading data...')).toBeInTheDocument()
  })

  it('keeps the previous rows mounted and dimmed while refetching', () => {
    const { rerenderWith } = renderTable({ data: ROWS, isLoading: false })
    expect(screen.getByText('Ada')).toBeInTheDocument()

    // A filter change: the host flips isLoading but still holds the old rows.
    rerenderWith({ data: ROWS, isLoading: true })

    // Rows survive — this is the regression: previously the body collapsed to a
    // 96px spinner row, cratering page height and bouncing scroll position.
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Grace')).toBeInTheDocument()
    expect(screen.queryByText('Loading data...')).toBeNull()
    expect(tbody()).toHaveAttribute('aria-busy', 'true')
    expect(tbody().className).toContain('opacity-70')
    expect(tbody().className).toContain('pointer-events-none')
  })

  it('clears the busy state once the new data lands', () => {
    const { rerenderWith } = renderTable({ data: ROWS, isLoading: true })
    rerenderWith({ data: [{ id: '3', name: 'Hopper' }], isLoading: false })

    expect(screen.getByText('Hopper')).toBeInTheDocument()
    expect(tbody()).not.toHaveAttribute('aria-busy')
    expect(tbody().className || '').not.toContain('opacity-70')
  })

  it('honours an explicit isRefetching even when isLoading is false', () => {
    renderTable({ data: ROWS, isLoading: false, isRefetching: true })
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(tbody()).toHaveAttribute('aria-busy', 'true')
  })
})

describe('DataTable — bulk actions cannot be double-fired', () => {
  beforeEach(() => { flashMock.mockReset() })

  function deferred<T>() {
    let resolve!: (v: T) => void
    let reject!: (e?: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  function selectFirstRow() {
    const boxes = document.querySelectorAll('[data-slot="table-body"] input[type="checkbox"], [data-slot="table-body"] [role="checkbox"]')
    if (!boxes.length) throw new Error('[internal] no row checkbox rendered')
    fireEvent.click(boxes[0] as HTMLElement)
  }

  it('disables the action while it runs and re-enables it after', async () => {
    const gate = deferred<void>()
    const onExecute = jest.fn(() => gate.promise)
    renderTable({
      data: ROWS,
      bulkActions: [{ id: 'del', label: 'Delete selected', destructive: true, onExecute }],
    })

    selectFirstRow()
    const button = await screen.findByRole('button', { name: /delete selected/i })

    await act(async () => { fireEvent.click(button) })
    expect(onExecute).toHaveBeenCalledTimes(1)

    // Second click while in flight must not fire a second bulk delete.
    await act(async () => { fireEvent.click(button) })
    expect(onExecute).toHaveBeenCalledTimes(1)
    expect((button as HTMLButtonElement).disabled).toBe(true)

    await act(async () => { gate.resolve(); await gate.promise })
  })

  it('flashes an error when the bulk action throws instead of swallowing it', async () => {
    const onExecute = jest.fn(async () => { throw new Error('bulk boom') })
    renderTable({
      data: ROWS,
      bulkActions: [{ id: 'del', label: 'Delete selected', destructive: true, onExecute }],
    })

    selectFirstRow()
    const button = await screen.findByRole('button', { name: /delete selected/i })
    await act(async () => { fireEvent.click(button) })

    await waitFor(() => { expect(flashMock).toHaveBeenCalledWith('bulk boom', 'error') })
  })
})
