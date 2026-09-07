"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { Plus } from 'lucide-react'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'

const PAGE_SIZE = 50

type AreaTypeRow = {
  id: string
  name: string
  description: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
  isActive: boolean
  updatedAt: string | null
  areaCount: number
}

type AreaTypesResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

export default function ResourcesAreaTypesPage() {
  const translate = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<AreaTypeRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const { confirm } = useConfirmDialog()

  const translations = React.useMemo(() => ({
    title: translate('resources.areaTypes.page.title', 'Area Types'),
    description: translate('resources.areaTypes.page.description', 'Classify resource areas by type.'),
    table: {
      name: translate('resources.areaTypes.table.name', 'Name'),
      description: translate('resources.areaTypes.table.description', 'Description'),
      areas: translate('resources.areaTypes.table.areas', 'Areas'),
      updatedAt: translate('resources.areaTypes.table.updatedAt', 'Updated'),
      empty: translate('resources.areaTypes.table.empty', 'No area types yet.'),
      search: translate('resources.areaTypes.table.search', 'Search area types…'),
    },
    actions: {
      add: translate('resources.areaTypes.actions.add', 'Add area type'),
      edit: translate('resources.areaTypes.actions.edit', 'Edit'),
      delete: translate('resources.areaTypes.actions.delete', 'Delete'),
    },
    messages: {
      deleted: translate('resources.areaTypes.messages.deleted', 'Area type deleted.'),
    },
    errors: {
      delete: translate('resources.areaTypes.errors.delete', 'Failed to delete area type.'),
      load: translate('resources.areaTypes.errors.load', 'Failed to load area types.'),
    },
    confirm: {
      deleteTitle: translate('resources.areaTypes.confirm.delete.title', 'Delete area type?'),
      deleteMessage: translate('resources.areaTypes.confirm.delete.message', 'This action cannot be undone.'),
    },
  }), [translate])

  const load = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const sortField = sorting[0]?.id ?? 'name'
      const sortDir = sorting[0]?.desc ? 'desc' : 'asc'
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        sortField,
        sortDir,
        withAreaCounts: 'true',
      })
      if (search.trim()) params.set('search', search.trim())
      const payload = await readApiResultOrThrow<AreaTypesResponse>(`/api/resources/area-types?${params.toString()}`)
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapAreaTypeRow))
      setTotal(payload.total ?? 0)
      setTotalPages(payload.totalPages ?? 1)
    } catch {
      flash(translations.errors.load, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [page, sorting, search, scopeVersion, reloadToken, translations.errors.load])

  React.useEffect(() => { void load() }, [load])

  const handleDelete = React.useCallback(async (id: string, updatedAt: string | null) => {
    const confirmed = await confirm({
      title: translations.confirm.deleteTitle,
      description: translations.confirm.deleteMessage,
      confirmText: translations.actions.delete,
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      const headers = buildOptimisticLockHeader(updatedAt)
      await withScopedApiRequestHeaders(headers, () =>
        deleteCrud('resources/area-types', id, {
          errorMessage: translations.errors.delete,
        }),
      )
      flash(translations.messages.deleted, 'success')
      setReloadToken((t) => t + 1)
    } catch {
      flash(translations.errors.delete, 'error')
    }
  }, [confirm, translations])

  const columns = React.useMemo<ColumnDef<AreaTypeRow>[]>(() => [
    {
      accessorKey: 'name',
      header: translations.table.name,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.original.appearanceIcon && (
            <span className="text-lg">{row.original.appearanceIcon}</span>
          )}
          <div>
            <div className="font-medium text-sm">{row.original.name}</div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'description',
      header: translations.table.description,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground line-clamp-2">
          {row.original.description ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'areaCount',
      header: translations.table.areas,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.areaCount}</span>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: translations.table.updatedAt,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.updatedAt ? formatDateTime(row.original.updatedAt) : '—'}
        </span>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <RowActions
          items={[
            {
              id: `edit-${row.original.id}`,
              label: translations.actions.edit,
              href: `/backend/resources/area-types/${row.original.id}/edit`,
            },
            {
              id: `delete-${row.original.id}`,
              label: translations.actions.delete,
              onSelect: () => handleDelete(row.original.id, row.original.updatedAt),
            },
          ]}
        />
      ),
    },
  ], [translations, handleDelete])

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">{translations.title}</h1>
              <p className="text-sm text-muted-foreground">{translations.description}</p>
            </div>
            <Button
              onClick={() => router.push('/backend/resources/area-types/create')}
            >
              <Plus className="mr-2 h-4 w-4" />
              {translations.actions.add}
            </Button>
          </div>

          <DataTable<AreaTypeRow>
            columns={columns}
            data={rows}
            isLoading={isLoading}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder={translations.table.search}
            emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{translations.table.empty}</p>}
            sortable
            sorting={sorting}
            onSortingChange={setSorting}
            pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
          />
        </div>
      </PageBody>
    </Page>
  )
}

function mapAreaTypeRow(item: Record<string, unknown>): AreaTypeRow {
  return {
    id: typeof item.id === 'string' ? item.id : '',
    name: typeof item.name === 'string' ? item.name : '',
    description: typeof item.description === 'string' ? item.description : null,
    appearanceIcon: typeof item.appearanceIcon === 'string'
      ? item.appearanceIcon
      : typeof item.appearance_icon === 'string'
        ? item.appearance_icon
        : null,
    appearanceColor: typeof item.appearanceColor === 'string'
      ? item.appearanceColor
      : typeof item.appearance_color === 'string'
        ? item.appearance_color
        : null,
    isActive: item.isActive !== false,
    updatedAt: typeof item.updatedAt === 'string'
      ? item.updatedAt
      : typeof item.updated_at === 'string'
        ? item.updated_at
        : null,
    areaCount: typeof item.areaCount === 'number'
      ? item.areaCount
      : typeof item.area_count === 'number'
        ? item.area_count
        : 0,
  }
}
