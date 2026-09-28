/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import type { ColumnDef } from '@tanstack/react-table'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { PerspectivesIndexResponse } from '@open-mercato/shared/modules/perspectives/types'
import { DataTable } from '../DataTable'
import type { ColumnChooserField } from '../columns/ColumnChooserPanel'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

jest.mock('../utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, status: 200, result: undefined, response: { ok: true, status: 200 }, cacheStatus: null })),
  withScopedApiRequestHeaders: async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
}))

// The sidebar is not under test: the stub lists the columns the table offers it.
jest.mock('../PerspectiveSidebar', () => ({
  PerspectiveSidebar: (props: { availableColumns: ColumnChooserField[] }) => (
    <ul data-testid="offered-columns">
      {props.availableColumns.map((field) => <li key={field.key}>{field.key}</li>)}
    </ul>
  ),
}))

type Row = { id: string; name: string }

const INDEX: PerspectivesIndexResponse = {
  tableId: 'chooser-table',
  perspectives: [],
  defaultPerspectiveId: null,
  rolePerspectives: [],
  manageableRolePerspectives: [],
  roles: [],
  canApplyToRoles: false,
}

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'cf_kept', header: 'Kept', meta: { hidden: true } } as ColumnDef<Row>,
]

const availableColumns: ColumnChooserField[] = [
  { key: 'name', label: 'Name', group: 'Columns', alwaysVisible: true },
  { key: 'cf_kept', label: 'Kept', group: 'Custom Fields', defaultVisible: false },
  { key: 'cf_retired', label: 'Retired', group: 'Custom Fields', defaultVisible: false },
]

function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  })
  queryClient.setQueryData(['feature-check', 'perspectives'], { use: true, roleDefaults: false })
  queryClient.setQueryData(['table-perspectives', 'chooser-table'], INDEX)
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        <DataTable<Row>
          columns={columns}
          data={[]}
          perspective={{ tableId: 'chooser-table' }}
          columnChooser={{ availableColumns }}
        />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

describe('DataTable column chooser', () => {
  beforeEach(() => window.localStorage.clear())

  it('offers only the fields the table has a column for', async () => {
    renderTable()
    const offered = await screen.findByTestId('offered-columns')
    await waitFor(() => {
      expect(Array.from(offered.querySelectorAll('li')).map((item) => item.textContent)).toEqual(['name', 'cf_kept'])
    })
  })
})
