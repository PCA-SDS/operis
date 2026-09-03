"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { markdownToPlainText } from '@open-mercato/ui/backend/markdown/markdownToPlainText'
import { DataTable, withDataTableNamespaces } from '@open-mercato/ui/backend/DataTable'
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

const logger = createLogger('resources').child({ component: 'resource-areas-page' })

const PAGE_SIZE = 50
const DESCRIPTION_CLASSNAME = 'line-clamp-3 whitespace-pre-line text-sm text-foreground'
const SUBTEXT_CLASSNAME = 'line-clamp-2 text-xs text-muted-foreground'
const RESOURCE_AREAS_MUTATION_CONTEXT_ID = 'resources.resource-areas.list'

type ResourceAreaRow = {
  id: string
  name: string
  description: string | null
  area_type: string
  parent_area_id: string | null
  sort_order: number
  appearance_icon: string | null
  appearance_color: string | null
  is_active: boolean
  updatedAt: string | null
  depth?: number // for nested table
}

type ResourceAreasResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

type ResourceAreasMutationContext = {
  formId: string
  resourceKind: string
  resourceId?: string
  retryLastMutation: () => Promise<boolean>
}

export default function ResourcesResourceAreasPage() {
  const translate = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<ResourceAreaRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const { runMutation, retryLastMutation } = useGuardedMutation<ResourceAreasMutationContext>({
    contextId: RESOURCE_AREAS_MUTATION_CONTEXT_ID,
    blockedMessage: translate('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  
  const runResourceAreaMutation = React.useCallback(
    async <T,>(
      operation: () => Promise<T>,
      mutationPayload: Record<string, unknown>,
      resourceId?: string,
    ): Promise<T> => runMutation({
      operation,
      mutationPayload,
      context: {
        formId: RESOURCE_AREAS_MUTATION_CONTEXT_ID,
        resourceKind: 'resources.resourceArea',
        resourceId,
        retryLastMutation,
      },
    }),
    [retryLastMutation, runMutation],
  )

  const translations = React.useMemo(() => ({
    title: translate('resources.resourceAreas.page.title', 'Resource Areas'),
    description: translate('resources.resourceAreas.page.description', 'Manage hierarchical locations like buildings and rooms.'),
    table: {
      name: translate('resources.resourceAreas.table.name', 'Name'),
      description: translate('resources.resourceAreas.table.description', 'Description'),
      areaType: translate('resources.resourceAreas.table.areaType', 'Type'),
      appearance: translate('resources.resourceAreas.table.appearance', 'Appearance'),
      updatedAt: translate('resources.resourceAreas.table.updatedAt', 'Updated'),
      empty: translate('resources.resourceAreas.table.empty', 'No resource areas yet.'),
      search: translate('resources.resourceAreas.table.search', 'Search resource areas…'),
    },
    actions: {
      add: translate('resources.resourceAreas.actions.add', 'Add resource area'),
      edit: translate('resources.resourceAreas.actions.edit', 'Edit'),
      delete: translate('resources.resourceAreas.actions.delete', 'Delete'),
      deleteConfirm: translate('resources.resourceAreas.actions.deleteConfirm', 'Delete resource area "{{name}}"?'),
      refresh: translate('resources.resourceAreas.actions.refresh', 'Refresh'),
    },
    messages: {
      deleted: translate('resources.resourceAreas.messages.deleted', 'Resource area deleted.'),
    },
    errors: {
      load: translate('resources.resourceAreas.errors.load', 'Failed to load resource areas.'),
      delete: translate('resources.resourceAreas.errors.delete', 'Failed to delete resource area.'),
      deleteAssigned: translate('resources.resourceAreas.errors.deleteAssigned', 'Cannot delete an area with children or assigned resources.'),
    },
  }), [translate])

  const columns = React.useMemo<ColumnDef<ResourceAreaRow>[]>(() => [
    {
      accessorKey: 'name',
      header: translations.table.name,
      meta: { priority: 1, sticky: true },
      cell: ({ row }) => {
        const depth = row.original.depth || 0;
        const paddingLeft = `${depth * 24}px`;
        return (
          <div className="flex flex-col" style={{ paddingLeft }}>
            <span className="font-medium">
              {depth > 0 && <span className="mr-2 text-muted-foreground">↳</span>}
              {row.original.name}
            </span>
            {row.original.description ? (
              <span className={SUBTEXT_CLASSNAME}>
                {markdownToPlainText(row.original.description)}
              </span>
            ) : null}
          </div>
        )
      },
    },
    {
      accessorKey: 'area_type',
      header: translations.table.areaType,
      meta: { priority: 3 },
      cell: ({ row }) => (
        <span className="text-sm uppercase tracking-wider text-muted-foreground">
          {row.original.area_type}
        </span>
      ),
    },
    {
      accessorKey: 'appearance',
      header: translations.table.appearance,
      meta: { priority: 2 },
      cell: ({ row }) => {
        const icon = row.original.appearance_icon
        const color = row.original.appearance_color
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
      accessorKey: 'updatedAt',
      header: translations.table.updatedAt,
      meta: { priority: 4 },
      cell: ({ row }) => row.original.updatedAt
        ? <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updatedAt)}</span>
        : <span className="text-xs text-muted-foreground">—</span>,
    },
  ], [translations])

  const loadResourceAreas = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (search.trim()) {
        params.set('search', search.trim())
      }
      const payload = await readApiResultOrThrow<ResourceAreasResponse>(
        `/api/resources/areas?${params.toString()}`,
        undefined,
        { errorMessage: translations.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      const mapped = items.map(mapApiResourceArea)
      
      setRows(mapped)
      setTotal(payload.total ?? 0)
      setTotalPages(payload.totalPages ?? 1)
    } catch (error) {
      logger.error('Failed to list resource areas', { err: error })
      flash(translations.errors.load, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [page, search, translations.errors.load])

  React.useEffect(() => {
    void loadResourceAreas()
  }, [loadResourceAreas, scopeVersion, reloadToken])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(async (entry: ResourceAreaRow) => {
    const message = translations.actions.deleteConfirm.replace('{{name}}', entry.name)
    const confirmed = await confirm({
      title: message,
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      const headers = buildOptimisticLockHeader(entry.updatedAt)
      await runResourceAreaMutation(
        () => withScopedApiRequestHeaders(headers, () => (
          deleteCrud('resources/areas', entry.id, { errorMessage: translations.errors.delete })
        )),
        { operation: 'deleteResourceArea', id: entry.id, updatedAt: entry.updatedAt ?? null },
        entry.id,
      )
      flash(translations.messages.deleted, 'success')
      handleRefresh()
    } catch (error: any) {
      logger.error('Failed to delete resource area', { err: error })
      if (error?.status === 400) {
        flash(translations.errors.deleteAssigned, 'error')
      } else {
        flash(translations.errors.delete, 'error')
      }
    }
  }, [confirm, handleRefresh, runResourceAreaMutation, translations.actions.deleteConfirm, translations.errors.delete, translations.errors.deleteAssigned, translations.messages.deleted])

  return (
    <Page>
      <PageBody>
        <DataTable<ResourceAreaRow>
          title={translations.title}
          data={rows}
          columns={columns}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={translations.table.search}
          emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{translations.table.empty}</p>}
          actions={(
            <Button asChild size="sm">
              <Link href="/backend/resources/areas/create">
                {translations.actions.add}
              </Link>
            </Button>
          )}
          refreshButton={{
            label: translations.actions.refresh,
            onRefresh: handleRefresh,
            isRefreshing: isLoading,
          }}
          sortable={false}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'edit', label: translations.actions.edit, href: `/backend/resources/areas/${row.id}/edit` },
                { id: 'delete', label: translations.actions.delete, destructive: true, onSelect: () => handleDelete(row) },
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/resources/areas/${row.id}/edit`)}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}

function mapApiResourceArea(item: Record<string, unknown>): ResourceAreaRow {
  const id = typeof item.id === 'string' ? item.id : ''
  const name = typeof item.name === 'string' && item.name.length ? item.name : id
  const description = typeof item.description === 'string' && item.description.length ? item.description : null
  const area_type = typeof item.area_type === 'string' ? item.area_type : 'other'
  const parent_area_id = typeof item.parent_area_id === 'string' ? item.parent_area_id : null
  const sort_order = typeof item.sort_order === 'number' ? item.sort_order : 0
  const appearance_icon = typeof item.appearance_icon === 'string' ? item.appearance_icon : null
  const appearance_color = typeof item.appearance_color === 'string' ? item.appearance_color : null
  const is_active = typeof item.is_active === 'boolean' ? item.is_active : true
  
  const updatedAt = typeof item.updatedAt === 'string'
    ? item.updatedAt
    : typeof item.updated_at === 'string'
      ? item.updated_at
      : null
  
  const depth = typeof item.depth === 'number' ? item.depth : 0
  
  return withDataTableNamespaces({ 
    id, name, description, area_type, parent_area_id, sort_order,
    appearance_icon, appearance_color, is_active, updatedAt, depth 
  }, item)
}
