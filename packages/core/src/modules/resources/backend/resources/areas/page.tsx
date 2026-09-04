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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ChevronDown, ChevronRight, GripVertical, Loader2 } from 'lucide-react'

const logger = createLogger('resources').child({ component: 'resource-areas-page' })

const PAGE_SIZE = 50
const CHILD_PAGE_SIZE = 100
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
  depth: number
  child_count: number
  path_label: string | null
}

type ResourceAreaTableRow =
  | (ResourceAreaRow & { rowKind: 'area' })
  | {
      id: string
      rowKind: 'loadMore'
      parentId: string
      depth: number
      loadedCount: number
      totalCount: number
    }

type ResourceAreasResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

type ChildPageState = {
  page: number
  totalPages: number
  total: number
}

type ResourceAreaMoveDialogState = {
  area: ResourceAreaRow
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
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'sort_order', desc: false }])
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [expandedAreaIds, setExpandedAreaIds] = React.useState<Set<string>>(new Set())
  const [childRowsByParentId, setChildRowsByParentId] = React.useState<Map<string, ResourceAreaRow[]>>(new Map())
  const [childPageByParentId, setChildPageByParentId] = React.useState<Map<string, ChildPageState>>(new Map())
  const [loadingChildrenIds, setLoadingChildrenIds] = React.useState<Set<string>>(new Set())
  const [draggingAreaId, setDraggingAreaId] = React.useState<string | null>(null)
  const [moveDialog, setMoveDialog] = React.useState<ResourceAreaMoveDialogState | null>(null)
  const [moveDialogSearch, setMoveDialogSearch] = React.useState('')
  const [moveDialogOptions, setMoveDialogOptions] = React.useState<ResourceAreaRow[]>([])
  const [moveDialogLoading, setMoveDialogLoading] = React.useState(false)
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
      children: translate('resources.resourceAreas.table.children', 'Child areas'),
      description: translate('resources.resourceAreas.table.description', 'Description'),
      areaType: translate('resources.resourceAreas.table.areaType', 'Type'),
      appearance: translate('resources.resourceAreas.table.appearance', 'Appearance'),
      updatedAt: translate('resources.resourceAreas.table.updatedAt', 'Updated'),
      empty: translate('resources.resourceAreas.table.empty', 'No resource areas yet.'),
      search: translate('resources.resourceAreas.table.search', 'Search resource areas…'),
      loadMoreChildren: translate('resources.resourceAreas.table.loadMoreChildren', 'Load more child areas'),
      reorderDisabled: translate('resources.resourceAreas.table.reorderDisabled', 'Reordering is available when viewing areas by order without filters.'),
    },
    filters: {
      status: translate('resources.resourceAreas.filters.status', 'Status'),
      active: translate('resources.resourceAreas.filters.active', 'Active'),
      inactive: translate('resources.resourceAreas.filters.inactive', 'Inactive'),
      areaType: translate('resources.resourceAreas.filters.areaType', 'Area type'),
    },
    types: {
      campus: translate('resources.resourceAreas.types.campus', 'Campus'),
      building: translate('resources.resourceAreas.types.building', 'Building'),
      floor: translate('resources.resourceAreas.types.floor', 'Floor'),
      zone: translate('resources.resourceAreas.types.zone', 'Zone'),
      room: translate('resources.resourceAreas.types.room', 'Room'),
      section: translate('resources.resourceAreas.types.section', 'Section'),
      other: translate('resources.resourceAreas.types.other', 'Other'),
    },
    actions: {
      add: translate('resources.resourceAreas.actions.add', 'Add resource area'),
      edit: translate('resources.resourceAreas.actions.edit', 'Edit'),
      delete: translate('resources.resourceAreas.actions.delete', 'Delete'),
      deleteConfirm: translate('resources.resourceAreas.actions.deleteConfirm', 'Delete resource area "{{name}}"?'),
      refresh: translate('resources.resourceAreas.actions.refresh', 'Refresh'),
      expand: translate('resources.resourceAreas.actions.expand', 'Expand area'),
      collapse: translate('resources.resourceAreas.actions.collapse', 'Collapse area'),
      dragToReorder: translate('resources.resourceAreas.actions.dragToReorder', 'Drag to reorder'),
      moveDown: translate('resources.resourceAreas.actions.moveDown', 'Move down'),
      moveUp: translate('resources.resourceAreas.actions.moveUp', 'Move up'),
      moveTo: translate('resources.resourceAreas.actions.moveTo', 'Move to...'),
      cancel: translate('common.cancel', 'Cancel'),
    },
    moveDialog: {
      title: translate('resources.resourceAreas.moveDialog.title', 'Move area'),
      search: translate('resources.resourceAreas.moveDialog.search', 'Search sibling areas...'),
      loading: translate('resources.resourceAreas.moveDialog.loading', 'Loading areas...'),
      empty: translate('resources.resourceAreas.moveDialog.empty', 'No sibling areas found.'),
    },
    messages: {
      deleted: translate('resources.resourceAreas.messages.deleted', 'Resource area deleted.'),
    },
    errors: {
      load: translate('resources.resourceAreas.errors.load', 'Failed to load resource areas.'),
      delete: translate('resources.resourceAreas.errors.delete', 'Failed to delete resource area.'),
      deleteAssigned: translate('resources.resourceAreas.errors.deleteAssigned', 'Cannot delete an area with children or assigned resources.'),
      reorder: translate('resources.resourceAreas.errors.reorder', 'Failed to reorder resource areas.'),
    },
  }), [translate])

  const canReorderAreas = React.useMemo(() => {
    const sort = sorting[0]
    const hasActiveFilters = Boolean(filterValues.status || filterValues.areaType || search.trim())
    return !hasActiveFilters && sort?.id === 'sort_order' && sort.desc !== true
  }, [filterValues.areaType, filterValues.status, search, sorting])

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
    {
      id: 'areaType',
      label: translations.filters.areaType,
      type: 'select',
      options: [
        { value: 'campus', label: translations.types.campus },
        { value: 'building', label: translations.types.building },
        { value: 'floor', label: translations.types.floor },
        { value: 'zone', label: translations.types.zone },
        { value: 'room', label: translations.types.room },
        { value: 'section', label: translations.types.section },
        { value: 'other', label: translations.types.other },
      ],
    },
  ], [translations])

  const loadChildren = React.useCallback(async (parentId: string, pageNumber = 1, append = false) => {
    setLoadingChildrenIds((current) => {
      const next = new Set(current)
      next.add(parentId)
      return next
    })
    try {
      const params = new URLSearchParams({
        parentAreaId: parentId,
        page: String(pageNumber),
        pageSize: String(CHILD_PAGE_SIZE),
      })
      const payload = await readApiResultOrThrow<ResourceAreasResponse>(
        `/api/resources/areas?${params.toString()}`,
        undefined,
        { errorMessage: translations.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      const mapped = items.map(mapApiResourceArea)
      setChildRowsByParentId((current) => {
        const next = new Map(current)
        const existing = append ? next.get(parentId) ?? [] : []
        const byId = new Map(existing.map((item) => [item.id, item]))
        for (const item of mapped) byId.set(item.id, item)
        next.set(parentId, Array.from(byId.values()))
        return next
      })
      setChildPageByParentId((current) => {
        const next = new Map(current)
        next.set(parentId, {
          page: pageNumber,
          totalPages: payload.totalPages ?? 1,
          total: payload.total ?? mapped.length,
        })
        return next
      })
    } catch (error) {
      logger.error('Failed to load child resource areas', { err: error, parentId })
      flash(translations.errors.load, 'error')
    } finally {
      setLoadingChildrenIds((current) => {
        const next = new Set(current)
        next.delete(parentId)
        return next
      })
    }
  }, [translations.errors.load])

  React.useEffect(() => {
    if (!moveDialog) {
      setMoveDialogOptions([])
      setMoveDialogSearch('')
      setMoveDialogLoading(false)
      return
    }
    const activeMoveDialog = moveDialog
    let cancelled = false
    const controller = new AbortController()
    async function loadMoveTargets() {
      setMoveDialogLoading(true)
      try {
        const params = new URLSearchParams({
          page: '1',
          pageSize: '100',
          parentAreaId: activeMoveDialog.area.parent_area_id ?? 'null',
          sortField: 'sort_order',
          sortDir: 'asc',
        })
        const searchTerm = moveDialogSearch.trim()
        if (searchTerm) params.set('search', searchTerm)
        const result = await readApiResultOrThrow<ResourceAreasResponse>(
          `/api/resources/areas?${params.toString()}`,
          { signal: controller.signal },
          { errorMessage: translations.errors.load },
        )
        if (cancelled) return
        const items = Array.isArray(result.items) ? result.items : []
        setMoveDialogOptions(
          items
            .map(mapApiResourceArea)
            .filter((area) => area.id !== activeMoveDialog.area.id),
        )
      } catch (error) {
        if (!cancelled) {
          logger.error('Failed to load resource area move targets', { err: error, areaId: activeMoveDialog.area.id })
          setMoveDialogOptions([])
        }
      } finally {
        if (!cancelled) setMoveDialogLoading(false)
      }
    }
    void loadMoveTargets()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [moveDialog, moveDialogSearch, translations.errors.load])

  const toggleAreaExpanded = React.useCallback((area: ResourceAreaRow) => {
    if (area.child_count <= 0) return
    setExpandedAreaIds((current) => {
      const next = new Set(current)
      if (next.has(area.id)) {
        next.delete(area.id)
        return next
      }
      next.add(area.id)
      if (!childRowsByParentId.has(area.id)) {
        void loadChildren(area.id)
      }
      return next
    })
  }, [childRowsByParentId, loadChildren])

  const loadMoreChildren = React.useCallback((parentId: string) => {
    const state = childPageByParentId.get(parentId)
    if (!state || state.page >= state.totalPages) return
    void loadChildren(parentId, state.page + 1, true)
  }, [childPageByParentId, loadChildren])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const getAreaSiblingRows = React.useCallback((parentAreaId: string | null): ResourceAreaRow[] => {
    return parentAreaId ? childRowsByParentId.get(parentAreaId) ?? [] : rows
  }, [childRowsByParentId, rows])

  const handleReorderArea = React.useCallback(async (
    area: ResourceAreaRow,
    movement: { direction?: 'up' | 'down'; targetId?: string; position?: 'top' | 'bottom' | 'before' | 'after' },
  ) => {
    if (!canReorderAreas) return
    try {
      const payload = { id: area.id, ...movement }
      await runResourceAreaMutation(
        () => apiCallOrThrow('/api/resources/areas/reorder', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }, { errorMessage: translations.errors.reorder }),
        { operation: 'reorderResourceArea', ...payload },
        area.id,
      )
      if (area.parent_area_id) {
        await loadChildren(area.parent_area_id)
      } else {
        handleRefresh()
      }
    } catch (error) {
      logger.error('Failed to reorder resource area', { err: error, areaId: area.id })
      flash(translations.errors.reorder, 'error')
    }
  }, [canReorderAreas, handleRefresh, loadChildren, runResourceAreaMutation, translations.errors.reorder])

  const handleMoveDialogSelect = React.useCallback(async (targetId: string) => {
    if (!moveDialog) return
    await handleReorderArea(moveDialog.area, { targetId, position: 'before' })
    setMoveDialog(null)
  }, [handleReorderArea, moveDialog])

  const handleAreaDrop = React.useCallback((target: ResourceAreaRow) => {
    if (!draggingAreaId || draggingAreaId === target.id || !canReorderAreas) return
    const siblings = getAreaSiblingRows(target.parent_area_id)
    const dragged = siblings.find((area) => area.id === draggingAreaId)
    if (!dragged || dragged.parent_area_id !== target.parent_area_id) return
    void handleReorderArea(dragged, { targetId: target.id })
  }, [canReorderAreas, draggingAreaId, getAreaSiblingRows, handleReorderArea])

  const tableRows = React.useMemo<ResourceAreaTableRow[]>(() => {
    const output: ResourceAreaTableRow[] = []
    const appendArea = (area: ResourceAreaRow) => {
      output.push({ ...area, rowKind: 'area' })
      if (!expandedAreaIds.has(area.id)) return
      const children = childRowsByParentId.get(area.id) ?? []
      for (const child of children) appendArea(child)
      const childPage = childPageByParentId.get(area.id)
      if (childPage && childPage.page < childPage.totalPages) {
        output.push({
          id: `load-more:${area.id}`,
          rowKind: 'loadMore',
          parentId: area.id,
          depth: area.depth + 1,
          loadedCount: children.length,
          totalCount: childPage.total,
        })
      }
    }
    for (const row of rows) appendArea(row)
    return output
  }, [childPageByParentId, childRowsByParentId, expandedAreaIds, rows])

  const columns = React.useMemo<ColumnDef<ResourceAreaTableRow>[]>(() => [
    {
      accessorKey: 'name',
      header: translations.table.name,
      meta: { priority: 1, sticky: true },
      cell: ({ row }) => {
        if (row.original.rowKind === 'loadMore') {
          const loadMoreRow = row.original
          const paddingLeft = `${loadMoreRow.depth * 24}px`
          const loading = loadingChildrenIds.has(loadMoreRow.parentId)
          return (
            <div style={{ paddingLeft }}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={(event) => {
                  event.stopPropagation()
                  loadMoreChildren(loadMoreRow.parentId)
                }}
              >
                {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {translations.table.loadMoreChildren}
              </Button>
            </div>
          )
        }
        const area = row.original
        const depth = area.depth || 0
        const paddingLeft = `${depth * 24}px`
        const hasChildren = area.child_count > 0
        const expanded = expandedAreaIds.has(area.id)
        const childrenLoading = loadingChildrenIds.has(area.id)
        return (
          <div
            className="flex flex-col gap-1"
            style={{ paddingLeft }}
            onDragOver={(event) => {
              if (!canReorderAreas || !draggingAreaId) return
              event.preventDefault()
            }}
            onDrop={(event) => {
              event.preventDefault()
              handleAreaDrop(area)
            }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex items-center gap-1" data-actions-cell>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 cursor-grab"
                  disabled={!canReorderAreas}
                  draggable={canReorderAreas}
                  title={canReorderAreas ? translations.actions.dragToReorder : translations.table.reorderDisabled}
                  aria-label={translations.actions.dragToReorder}
                  onClick={(event) => event.stopPropagation()}
                  onDragStart={(event) => {
                    event.stopPropagation()
                    setDraggingAreaId(area.id)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', area.id)
                  }}
                  onDragEnd={() => setDraggingAreaId(null)}
                >
                    <GripVertical className="size-4" aria-hidden />
                  </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                disabled={!hasChildren}
                aria-label={expanded ? translations.actions.collapse : translations.actions.expand}
                aria-expanded={hasChildren ? expanded : undefined}
                onClick={(event) => {
                  event.stopPropagation()
                  toggleAreaExpanded(area)
                }}
              >
                {childrenLoading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : expanded ? (
                  <ChevronDown className="size-4" aria-hidden />
                ) : (
                  <ChevronRight className="size-4" aria-hidden />
                )}
              </Button>
              <span className="min-w-0 truncate font-medium">{area.name}</span>
            </div>
            {area.description ? (
              <span className={SUBTEXT_CLASSNAME} style={{ paddingLeft: hasChildren ? 36 : 0 }}>
                {markdownToPlainText(area.description)}
              </span>
            ) : null}
          </div>
        )
      },
    },
    {
      accessorKey: 'child_count',
      header: translations.table.children,
      meta: { priority: 2 },
      cell: ({ row }) => row.original.rowKind === 'area' ? (
        <span className="text-sm tabular-nums text-muted-foreground">
          {row.original.child_count}
        </span>
      ) : null,
    },
    {
      accessorKey: 'area_type',
      header: translations.table.areaType,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.rowKind === 'area' ? (
        <span className="text-sm uppercase tracking-wider text-muted-foreground">
          {row.original.area_type}
        </span>
      ) : null,
    },
    {
      accessorKey: 'appearance',
      header: translations.table.appearance,
      meta: { priority: 2 },
      cell: ({ row }) => {
        if (row.original.rowKind !== 'area') return null
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
      cell: ({ row }) => row.original.rowKind === 'area' && row.original.updatedAt
        ? <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updatedAt)}</span>
        : row.original.rowKind === 'area'
          ? <span className="text-xs text-muted-foreground">—</span>
          : null,
    },
  ], [
    canReorderAreas,
    draggingAreaId,
    expandedAreaIds,
    handleAreaDrop,
    loadMoreChildren,
    loadingChildrenIds,
    toggleAreaExpanded,
    translations,
  ])

  const loadResourceAreas = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      const sort = sorting[0]
      if (sort?.id) {
        params.set('sortField', sort.id)
        params.set('sortDir', sort.desc ? 'desc' : 'asc')
      }
      const status = typeof filterValues.status === 'string' ? filterValues.status : ''
      if (status === 'active' || status === 'inactive') params.set('status', status)
      const areaType = typeof filterValues.areaType === 'string' ? filterValues.areaType : ''
      if (areaType) params.set('areaType', areaType)
      const hasActiveFilters = Boolean(status || areaType)
      if (search.trim()) {
        params.set('search', search.trim())
      } else if (!hasActiveFilters) {
        params.set('parentAreaId', 'null')
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
      setExpandedAreaIds(new Set())
      setChildRowsByParentId(new Map())
      setChildPageByParentId(new Map())
    } catch (error) {
      logger.error('Failed to list resource areas', { err: error })
      flash(translations.errors.load, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [filterValues.areaType, filterValues.status, page, search, sorting, translations.errors.load])

  React.useEffect(() => {
    void loadResourceAreas()
  }, [loadResourceAreas, scopeVersion, reloadToken])

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
        <DataTable<ResourceAreaTableRow>
          title={translations.title}
          data={tableRows}
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
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
          rowActions={(row) => (
            row.rowKind === 'area' ? (() => {
              const siblingRows = getAreaSiblingRows(row.parent_area_id)
              const siblingIndex = siblingRows.findIndex((item) => item.id === row.id)
              const reorderItems = canReorderAreas ? [
                {
                  id: 'move-up',
                  label: translations.actions.moveUp,
                  disabled: siblingIndex <= 0,
                  onSelect: () => { void handleReorderArea(row, { direction: 'up' }) },
                },
                {
                  id: 'move-down',
                  label: translations.actions.moveDown,
                  disabled: siblingIndex < 0 || siblingIndex >= siblingRows.length - 1,
                  onSelect: () => { void handleReorderArea(row, { direction: 'down' }) },
                },
                {
                  id: 'move-to',
                  label: translations.actions.moveTo,
                  disabled: siblingRows.length <= 1,
                  onSelect: () => setMoveDialog({ area: row }),
                },
              ] : []
              return (
                <RowActions
                  items={[
                    { id: 'edit', label: translations.actions.edit, href: `/backend/resources/areas/${row.id}/edit` },
                    ...reorderItems,
                    { id: 'delete', label: translations.actions.delete, destructive: true, onSelect: () => handleDelete(row) },
                  ]}
                />
              )
            })() : null
          )}
          onRowClick={(row) => {
            if (row.rowKind === 'area') router.push(`/backend/resources/areas/${row.id}/edit`)
          }}
          perspective={{ tableId: extensionPoints.hosts.resourceAreasTable.tableId }}
        />
      </PageBody>
      <Dialog open={Boolean(moveDialog)} onOpenChange={(open) => { if (!open) setMoveDialog(null) }}>
        <DialogContent size="default">
          <DialogHeader>
            <DialogTitle>
              {translations.moveDialog.title}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              value={moveDialogSearch}
              onChange={(event) => setMoveDialogSearch(event.target.value)}
              placeholder={translations.moveDialog.search}
            />
            <div className="max-h-72 overflow-y-auto rounded-md border border-border">
              {moveDialogLoading ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {translations.moveDialog.loading}
                </div>
              ) : moveDialogOptions.length ? (
                moveDialogOptions.map((area) => (
                  <button
                    key={area.id}
                    type="button"
                    className="flex w-full flex-col gap-0.5 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-accent"
                    onClick={() => { void handleMoveDialogSelect(area.id) }}
                  >
                    <span className="text-sm font-medium text-foreground">{area.name}</span>
                    {area.path_label ? (
                      <span className="text-xs text-muted-foreground">{area.path_label}</span>
                    ) : null}
                  </button>
                ))
              ) : (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {translations.moveDialog.empty}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setMoveDialog(null)}>
              {translations.actions.cancel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  const child_count = typeof item.child_count === 'number' ? item.child_count : 0
  const path_label = typeof item.path_label === 'string' ? item.path_label : null
  
  return withDataTableNamespaces({ 
    id, name, description, area_type, parent_area_id, sort_order,
    appearance_icon, appearance_color, is_active, updatedAt, depth, child_count, path_label
  }, item)
}
