"use client"

import * as React from 'react'
import { extensionPoints } from '@open-mercato/core/modules/resources/extension-points'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { markdownToPlainText } from '@open-mercato/ui/backend/markdown/markdownToPlainText'
import { DataTable, withDataTableNamespaces } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterOverlay'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('resources').child({ component: 'area-types-page' })

const PAGE_SIZE = 50
const DESCRIPTION_CLASSNAME = 'line-clamp-3 whitespace-pre-line text-sm text-foreground'
const SUBTEXT_CLASSNAME = 'line-clamp-2 text-xs text-muted-foreground'
const AREA_TYPES_MUTATION_CONTEXT_ID = 'resources.area-types.list'

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

type AreaTypesMutationContext = {
  formId: string
  resourceKind: string
  resourceId?: string
  retryLastMutation: () => Promise<boolean>
}

export default function ResourcesAreaTypesPage() {
  const translate = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<AreaTypeRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const { runMutation, retryLastMutation } = useGuardedMutation<AreaTypesMutationContext>({
    contextId: AREA_TYPES_MUTATION_CONTEXT_ID,
    blockedMessage: translate('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const runAreaTypeMutation = React.useCallback(
    async <T,>(
      operation: () => Promise<T>,
      mutationPayload: Record<string, unknown>,
      resourceId?: string,
    ): Promise<T> => runMutation({
      operation,
      mutationPayload,
      context: {
        formId: AREA_TYPES_MUTATION_CONTEXT_ID,
        resourceKind: 'resources.areaType',
        resourceId,
        retryLastMutation,
      },
    }),
    [retryLastMutation, runMutation],
  )

  const translations = React.useMemo(() => ({
    title: translate('resources.areaTypes.page.title', 'Area Types'),
    description: translate('resources.areaTypes.page.description', 'Classify resource areas by type.'),
    table: {
      name: translate('resources.areaTypes.table.name', 'Name'),
      description: translate('resources.areaTypes.table.description', 'Description'),
      appearance: translate('resources.areaTypes.table.appearance', 'Appearance'),
      areas: translate('resources.areaTypes.table.areas', 'Areas'),
      updatedAt: translate('resources.areaTypes.table.updatedAt', 'Updated'),
      empty: translate('resources.areaTypes.table.empty', 'No area types yet.'),
      search: translate('resources.areaTypes.table.search', 'Search area types…'),
    },
    filters: {
      status: translate('resources.areaTypes.filters.status', 'Status'),
      active: translate('resources.areaTypes.filters.active', 'Active'),
      inactive: translate('resources.areaTypes.filters.inactive', 'Inactive'),
    },
    actions: {
      add: translate('resources.areaTypes.actions.add', 'Add area type'),
      edit: translate('resources.areaTypes.actions.edit', 'Edit'),
      delete: translate('resources.areaTypes.actions.delete', 'Delete'),
      deleteConfirm: translate('resources.areaTypes.actions.deleteConfirm', 'Delete area type "{{name}}"?'),
      refresh: translate('resources.areaTypes.actions.refresh', 'Refresh'),
    },
    messages: {
      deleted: translate('resources.areaTypes.messages.deleted', 'Area type deleted.'),
    },
    errors: {
      delete: translate('resources.areaTypes.errors.delete', 'Failed to delete area type.'),
      deleteAssigned: translate('resources.areaTypes.errors.deleteAssigned', 'Area type has assigned areas.'),
      load: translate('resources.areaTypes.errors.load', 'Failed to load area types.'),
    },
  }), [translate])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'status',
      label: translations.filters.status,
      type: 'select',
      options: [
        { value: 'active', label: translations.filters.active },
        { value: 'inactive', label: translations.filters.inactive },
      ],
    },
  ], [translations.filters.active, translations.filters.inactive, translations.filters.status])

  const loadAreaTypes = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        withAreaCounts: 'true',
      })
      const sort = sorting[0]
      if (sort?.id) {
        params.set('sortField', sort.id)
        params.set('sortDir', sort.desc ? 'desc' : 'asc')
      }
      const status = typeof filterValues.status === 'string' ? filterValues.status : ''
      if (status === 'active' || status === 'inactive') params.set('status', status)
      if (search.trim()) params.set('search', search.trim())
      const payload = await readApiResultOrThrow<AreaTypesResponse>(
        `/api/resources/area-types?${params.toString()}`,
        undefined,
        { errorMessage: translations.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapAreaTypeRow))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : Math.max(1, Math.ceil(items.length / PAGE_SIZE)))
    } catch (error) {
      logger.error('Failed to list area types', { err: error })
      flash(translations.errors.load, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [filterValues.status, page, search, sorting, translations.errors.load])

  React.useEffect(() => {
    void loadAreaTypes()
  }, [loadAreaTypes, scopeVersion, reloadToken])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(async (entry: AreaTypeRow) => {
    if (entry.areaCount > 0) {
      flash(translations.errors.deleteAssigned, 'error')
      return
    }
    const message = translations.actions.deleteConfirm.replace('{{name}}', entry.name)
    const confirmed = await confirm({
      title: message,
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      const headers = buildOptimisticLockHeader(entry.updatedAt)
      await runAreaTypeMutation(
        () => withScopedApiRequestHeaders(headers, () => (
          deleteCrud('resources/area-types', entry.id, { errorMessage: translations.errors.delete })
        )),
        { operation: 'deleteAreaType', id: entry.id, updatedAt: entry.updatedAt ?? null },
        entry.id,
      )
      flash(translations.messages.deleted, 'success')
      handleRefresh()
    } catch (error) {
      logger.error('Failed to delete area type', { err: error })
      flash(translations.errors.delete, 'error')
    }
  }, [confirm, handleRefresh, runAreaTypeMutation, translations.actions.deleteConfirm, translations.errors.delete, translations.errors.deleteAssigned, translations.messages.deleted])

  const columns = React.useMemo<ColumnDef<AreaTypeRow>[]>(() => [
    {
      accessorKey: 'name',
      header: translations.table.name,
      meta: { priority: 1, sticky: true },
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          {row.original.description ? (
            <span className={SUBTEXT_CLASSNAME}>
              {markdownToPlainText(row.original.description)}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'appearance',
      header: translations.table.appearance,
      meta: { priority: 2 },
      cell: ({ row }) => {
        const icon = row.original.appearanceIcon
        const color = row.original.appearanceColor
        if (!icon && !color) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        return (
          <div className="flex items-center gap-2">
            {color ? renderDictionaryColor(color) : null}
            {icon ? renderDictionaryIcon(icon) : null}
          </div>
        )
      },
    },
    {
      accessorKey: 'areaCount',
      header: translations.table.areas,
      meta: { priority: 3 },
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">{row.original.areaCount}</span>
      ),
    },
    {
      accessorKey: 'description',
      header: translations.table.description,
      meta: { priority: 5 },
      cell: ({ row }) => row.original.description ? (
        <span className={DESCRIPTION_CLASSNAME}>
          {markdownToPlainText(row.original.description)}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: translations.table.updatedAt,
      meta: { priority: 4 },
      cell: ({ row }) => row.original.updatedAt
        ? <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updatedAt)}</span>
        : <span className="text-xs text-muted-foreground">—</span>,
    },
  ], [
    translations.table.appearance,
    translations.table.areas,
    translations.table.description,
    translations.table.name,
    translations.table.updatedAt,
  ])

  return (
    <Page>
      <PageBody>
        <DataTable<AreaTypeRow>
          title={translations.title}
          data={rows}
          columns={columns}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={translations.table.search}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{translations.table.empty}</p>}
          actions={(
            <Button asChild size="sm">
              <Link href="/backend/resources/area-types/create">
                {translations.actions.add}
              </Link>
            </Button>
          )}
          refreshButton={{
            label: translations.actions.refresh,
            onRefresh: handleRefresh,
            isRefreshing: isLoading,
          }}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'edit', label: translations.actions.edit, href: `/backend/resources/area-types/${row.id}/edit` },
                ...(row.areaCount > 0
                  ? []
                  : [{ id: 'delete', label: translations.actions.delete, destructive: true, onSelect: () => handleDelete(row) }]),
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/resources/area-types/${row.id}/edit`)}
          perspective={{ tableId: extensionPoints.hosts.areaTypesTable.tableId }}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}

function mapAreaTypeRow(item: Record<string, unknown>): AreaTypeRow {
  const id = typeof item.id === 'string' ? item.id : ''
  const name = typeof item.name === 'string' && item.name.length ? item.name : id
  const description = typeof item.description === 'string' && item.description.length
    ? item.description
    : typeof item.description === 'string'
      ? item.description
      : null
  const appearanceIcon = typeof item.appearanceIcon === 'string'
    ? item.appearanceIcon
    : typeof item.appearance_icon === 'string'
      ? item.appearance_icon
      : null
  const appearanceColor = typeof item.appearanceColor === 'string'
    ? item.appearanceColor
    : typeof item.appearance_color === 'string'
      ? item.appearance_color
      : null
  const isActive = item.isActive !== false
  const updatedAt = typeof item.updatedAt === 'string'
    ? item.updatedAt
    : typeof item.updated_at === 'string'
      ? item.updated_at
      : null
  const areaCount = typeof item.areaCount === 'number'
    ? item.areaCount
    : typeof item.area_count === 'number'
      ? item.area_count
      : 0
  return withDataTableNamespaces({
    id,
    name,
    description,
    appearanceIcon,
    appearanceColor,
    isActive,
    updatedAt,
    areaCount,
  }, item)
}
