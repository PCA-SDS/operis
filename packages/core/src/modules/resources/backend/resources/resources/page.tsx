"use client"

import * as React from 'react'
import { extensionPoints } from '@open-mercato/core/modules/resources/extension-points'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, withDataTableNamespaces } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { FilterDef, FilterOption, FilterValues } from '@open-mercato/ui/backend/FilterOverlay'
import type { TagOption } from '@open-mercato/ui/backend/detail'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { ArrowDown, ArrowUp, GripVertical, Pencil } from 'lucide-react'

const PAGE_SIZE = 20
const RESOURCE_LIST_MUTATION_CONTEXT_ID = 'resources.resources.list'

type ResourceRow = {
  id: string
  name: string
  resourceTypeId: string | null
  areaId: string | null
  sortOrder: number
  capacity: number | null
  tags?: TagOption[] | null
  isActive: boolean
  appearanceIcon?: string | null
  appearanceColor?: string | null
  updatedAt?: string | null
}

type ResourceTypeRow = {
  id: string
  name: string
  appearanceIcon: string | null
  appearanceColor: string | null
}

type ResourceGroupBy = 'resourceType' | 'area'

type ResourceGroupRow = {
  id: string
  name: string
  resourceTypeId: string | null
  areaId: string | null
  sortOrder: number | null
  appearanceIcon: string | null
  appearanceColor: string | null
  rowKind: 'group'
  depth: number
  groupBy: ResourceGroupBy
}

type ResourceTableRow = (ResourceRow & { rowKind: 'resource'; depth: number }) | ResourceGroupRow

type ResourcesResponse = {
  items: Array<Record<string, unknown>>
  total: number
  page: number
  totalPages: number
}

type ResourceTypesResponse = {
  items: Array<Record<string, unknown>>
}

type ResourceAreasResponse = {
  items: Array<{
    id?: string
    name?: string
    parent_area_id?: string | null
    sort_order?: number
    depth?: number
  }>
  totalPages?: number
}

type ResourceListMutationContext = {
  formId: string
  resourceKind: string
  resourceId?: string
  retryLastMutation: () => Promise<boolean>
}

function formatResourceAreaName(area: { name?: string; id?: string; depth?: number }): string | null {
  const name = typeof area.name === 'string' && area.name.length ? area.name : area.id
  if (!name) return null
  const depth = typeof area.depth === 'number' && area.depth > 0 ? area.depth : 0
  return depth > 0 ? `${'  '.repeat(depth)}↳ ${name}` : name
}

function sortResourcesForAreaLayout(resources: ResourceRow[]): ResourceRow[] {
  return [...resources].sort((a, b) => {
    const orderA = Number.isFinite(a.sortOrder) ? a.sortOrder : 0
    const orderB = Number.isFinite(b.sortOrder) ? b.sortOrder : 0
    if (orderA !== orderB) return orderA - orderB
    const nameCompare = a.name.localeCompare(b.name)
    return nameCompare !== 0 ? nameCompare : a.id.localeCompare(b.id)
  })
}

export default function ResourcesResourcesPage() {
  const [rows, setRows] = React.useState<ResourceRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [groupBy, setGroupBy] = React.useState<ResourceGroupBy>('resourceType')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [draggingResourceId, setDraggingResourceId] = React.useState<string | null>(null)
  const [resourceTypes, setResourceTypes] = React.useState<Map<string, ResourceTypeRow>>(new Map())
  const [resourceAreas, setResourceAreas] = React.useState<Map<string, { id: string; name: string }>>(new Map())
  const [canManage, setCanManage] = React.useState(false)
  const [tagOptions, setTagOptions] = React.useState<FilterOption[]>([])
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const resourceTypeFilter = searchParams.get('resourceTypeId')
  const selectedResourceTypeId = typeof filterValues.resourceTypeId === 'string'
    ? filterValues.resourceTypeId
    : resourceTypeFilter
  const { runMutation, retryLastMutation } = useGuardedMutation<ResourceListMutationContext>({
    contextId: RESOURCE_LIST_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const runResourceMutation = React.useCallback(
    async <T,>(
      operation: () => Promise<T>,
      mutationPayload: Record<string, unknown>,
      resourceId?: string,
    ): Promise<T> => runMutation({
      operation,
      mutationPayload,
      context: {
        formId: RESOURCE_LIST_MUTATION_CONTEXT_ID,
        resourceKind: 'resources.resource',
        resourceId,
        retryLastMutation,
      },
    }),
    [retryLastMutation, runMutation],
  )

  React.useEffect(() => {
    setPage(1)
  }, [resourceTypeFilter])

  React.useEffect(() => {
    if (!resourceTypeFilter) return
    setFilterValues((prev) => {
      if (prev.resourceTypeId === resourceTypeFilter) return prev
      if (typeof prev.resourceTypeId === 'string' && prev.resourceTypeId.length > 0) return prev
      return { ...prev, resourceTypeId: resourceTypeFilter }
    })
  }, [resourceTypeFilter])

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function loadPermissions() {
      try {
        const call = await apiCall<{ granted?: string[]; ok?: boolean }>('/api/auth/feature-check', {
          signal: controller.signal,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['resources.manage_resources'] }),
        })
        if (!cancelled) {
          const granted = Array.isArray(call.result?.granted) ? call.result?.granted : []
          setCanManage(call.result?.ok === true || granted.includes('resources.manage_resources'))
        }
      } catch {
        if (!cancelled) setCanManage(false)
      }
    }
    loadPermissions()
    return () => { cancelled = true; controller.abort() }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function loadResourceTypes() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '100' })
        const call = await apiCall<ResourceTypesResponse>(`/api/resources/resource-types?${params.toString()}`, { signal: controller.signal })
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const map = new Map<string, ResourceTypeRow>()
        for (const item of items) {
          const raw = item as Record<string, unknown>
          const id = typeof raw.id === 'string' ? raw.id : ''
          const name = typeof raw.name === 'string' ? raw.name : id
          const appearanceIcon = typeof raw.appearanceIcon === 'string'
            ? raw.appearanceIcon
            : typeof raw.appearance_icon === 'string'
              ? raw.appearance_icon
              : null
          const appearanceColor = typeof raw.appearanceColor === 'string'
            ? raw.appearanceColor
            : typeof raw.appearance_color === 'string'
              ? raw.appearance_color
              : null
          map.set(id, {
            id,
            name,
            appearanceIcon,
            appearanceColor,
          })
        }
        if (!cancelled) setResourceTypes(map)
      } catch {
        if (!cancelled) setResourceTypes(new Map())
      }
    }
    loadResourceTypes()
    return () => { cancelled = true; controller.abort() }
  }, [scopeVersion])

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function loadResourceAreas() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '100' })
        const call = await apiCall<ResourceAreasResponse>(`/api/resources/areas?${params.toString()}`, { signal: controller.signal })
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const result = new Map<string, { id: string; name: string }>()
        for (const item of items) {
          if (!item.id) continue
          const name = formatResourceAreaName(item)
          if (name) result.set(item.id, { id: item.id, name })
        }

        if (!cancelled) setResourceAreas(result)
      } catch {
        if (!cancelled) setResourceAreas(new Map())
      }
    }
    loadResourceAreas()
    return () => { cancelled = true; controller.abort() }
  }, [scopeVersion])

  React.useEffect(() => {
    const areaIds = new Set<string>()
    for (const row of rows) {
      if (row.areaId && !resourceAreas.has(row.areaId)) areaIds.add(row.areaId)
    }
    if (typeof filterValues.areaId === 'string' && filterValues.areaId.length && !resourceAreas.has(filterValues.areaId)) {
      areaIds.add(filterValues.areaId)
    }
    if (areaIds.size === 0) return

    let cancelled = false
    const controller = new AbortController()
    async function loadVisibleResourceAreas() {
      try {
        const params = new URLSearchParams({ ids: Array.from(areaIds).join(','), page: '1', pageSize: String(areaIds.size) })
        const call = await apiCall<ResourceAreasResponse>(`/api/resources/areas?${params.toString()}`, { signal: controller.signal })
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        if (cancelled || items.length === 0) return
        setResourceAreas((current) => {
          const next = new Map(current)
          for (const item of items) {
            if (!item.id) continue
            const name = formatResourceAreaName(item)
            if (name) next.set(item.id, { id: item.id, name })
          }
          return next
        })
      } catch {
        if (!cancelled) setResourceAreas((current) => current)
      }
    }
    void loadVisibleResourceAreas()
    return () => { cancelled = true; controller.abort() }
  }, [filterValues.areaId, resourceAreas, rows])

  const loadTagOptions = React.useCallback(
    async (query?: string): Promise<FilterOption[]> => {
      try {
        const params = new URLSearchParams({ pageSize: '100' })
        if (query && query.trim().length) params.set('search', query.trim())
        const call = await apiCall<{ items?: Array<{ id?: string; label?: string; slug?: string }> }>(`/api/resources/tags?${params.toString()}`)
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const options = items
          .map((entry) => {
            const value = typeof entry.id === 'string' ? entry.id : null
            if (!value) return null
            const label = typeof entry.label === 'string' && entry.label.trim().length
              ? entry.label.trim()
              : typeof entry.slug === 'string' && entry.slug.trim().length
                ? entry.slug.trim()
                : value
            return { value, label }
          })
          .filter((option): option is FilterOption => option !== null)
        if (options.length > 0) {
          setTagOptions((prev) => {
            const map = new Map(prev.map((opt) => [opt.value, opt]))
            options.forEach((opt) => map.set(opt.value, opt))
            return Array.from(map.values())
          })
        }
        return options
      } catch {
        return []
      }
    },
    [],
  )

  const resourceTypeOptions = React.useMemo<FilterOption[]>(() => {
    const entries = Array.from(resourceTypes.values())
    entries.sort((a, b) => a.name.localeCompare(b.name))
    return entries.map((entry) => ({ value: entry.id, label: entry.name }))
  }, [resourceTypes])

  const resourceAreaOptions = React.useMemo<FilterOption[]>(() => {
    const entries = Array.from(resourceAreas.values())
    return entries.map((entry) => ({ value: entry.id, label: entry.name }))
  }, [resourceAreas])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'resourceTypeId',
      label: t('resources.resources.list.filters.resourceType', 'Resource type'),
      type: 'select',
      options: resourceTypeOptions,
    },
    {
      id: 'areaId',
      label: t('resources.resources.list.filters.area', 'Area'),
      type: 'select',
      options: resourceAreaOptions,
    },
    {
      id: 'tagIds',
      label: t('resources.resources.list.filters.tags', 'Tags'),
      type: 'tags',
      loadOptions: loadTagOptions,
      options: tagOptions,
      formatValue: (val: string) => tagOptions.find((o) => o.value === val)?.label ?? val,
    },
  ], [loadTagOptions, resourceTypeOptions, resourceAreaOptions, tagOptions, t])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
    setPage(1)

    const params = new URLSearchParams(searchParams?.toString())
    const hasResourceType = typeof values.resourceTypeId === 'string' && values.resourceTypeId.length > 0
    if (!hasResourceType && params.has('resourceTypeId')) {
      params.delete('resourceTypeId')
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname)
    }
  }, [pathname, router, searchParams])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)

    const params = new URLSearchParams(searchParams?.toString())
    if (params.has('resourceTypeId')) {
      params.delete('resourceTypeId')
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname)
    }
  }, [pathname, router, searchParams])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const canReorderResources = canManage && groupBy === 'area'

  const handleReorderResource = React.useCallback(async (
    resource: ResourceRow,
    movement: { direction?: 'up' | 'down'; targetId?: string },
  ) => {
    if (!canReorderResources) return
    try {
      const payload = { id: resource.id, ...movement }
      await runResourceMutation(
        () => apiCallOrThrow('/api/resources/resources/reorder', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }, { errorMessage: t('resources.resources.list.error.reorder', 'Failed to reorder resources.') }),
        { operation: 'reorderResource', ...payload },
        resource.id,
      )
      handleRefresh()
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t('resources.resources.list.error.reorder', 'Failed to reorder resources.')
      flash(message, 'error')
    }
  }, [canReorderResources, handleRefresh, runResourceMutation, t])

  const handleResourceDrop = React.useCallback((target: ResourceRow) => {
    if (!draggingResourceId || draggingResourceId === target.id || !canReorderResources) return
    const dragged = rows.find((row) => row.id === draggingResourceId)
    if (!dragged || dragged.areaId !== target.areaId) return
    void handleReorderResource(dragged, { targetId: target.id })
  }, [canReorderResources, draggingResourceId, handleReorderResource, rows])

  const groupedRows = React.useMemo(() => {
    const grouped: ResourceTableRow[] = []
    if (!rows.length) return grouped
    if (groupBy === 'area') {
      const byArea = new Map<string, ResourceRow[]>()
      const unassigned: ResourceRow[] = []
      rows.forEach((row) => {
        if (!row.areaId) {
          unassigned.push(row)
          return
        }
        const list = byArea.get(row.areaId) ?? []
        list.push(row)
        byArea.set(row.areaId, list)
      })
      const areaEntries = Array.from(byArea.entries())
        .map(([areaId, list]) => ({
          areaId,
          list,
          area: resourceAreas.get(areaId),
        }))
        .sort((a, b) => {
          const nameA = a.area?.name ?? ''
          const nameB = b.area?.name ?? ''
          return nameA.localeCompare(nameB)
        })
      for (const entry of areaEntries) {
        grouped.push({
          id: `group:area:${entry.areaId}`,
          name: entry.area?.name ?? t('resources.resources.list.group.unknownArea', 'Unknown area'),
          resourceTypeId: null,
          areaId: entry.areaId,
          sortOrder: null,
          appearanceIcon: null,
          appearanceColor: null,
          rowKind: 'group',
          depth: 0,
          groupBy: 'area',
        })
        sortResourcesForAreaLayout(entry.list).forEach((resource) => {
          grouped.push({ ...resource, rowKind: 'resource', depth: 1 })
        })
      }
      if (unassigned.length) {
        grouped.push({
          id: 'group:area:unassigned',
          name: t('resources.resources.list.group.unassignedArea', 'No area'),
          resourceTypeId: null,
          areaId: null,
          sortOrder: null,
          appearanceIcon: null,
          appearanceColor: null,
          rowKind: 'group',
          depth: 0,
          groupBy: 'area',
        })
        sortResourcesForAreaLayout(unassigned).forEach((resource) => {
          grouped.push({ ...resource, rowKind: 'resource', depth: 1 })
        })
      }
      return grouped
    }

    const byType = new Map<string, ResourceRow[]>()
    const unassigned: ResourceRow[] = []
    rows.forEach((row) => {
      if (!row.resourceTypeId) {
        unassigned.push(row)
        return
      }
      const list = byType.get(row.resourceTypeId) ?? []
      list.push(row)
      byType.set(row.resourceTypeId, list)
    })
    const typeEntries = Array.from(byType.entries())
      .map(([typeId, list]) => ({
        typeId,
        list,
        type: resourceTypes.get(typeId),
      }))
      .sort((a, b) => {
        const nameA = a.type?.name ?? ''
        const nameB = b.type?.name ?? ''
        return nameA.localeCompare(nameB)
      })
    for (const entry of typeEntries) {
      const label = entry.type?.name ?? t('resources.resources.list.group.unknown', 'Unknown type')
      grouped.push({
        id: `group:${entry.typeId}`,
        name: label,
        resourceTypeId: entry.typeId,
        areaId: null,
        sortOrder: null,
        appearanceIcon: entry.type?.appearanceIcon ?? null,
        appearanceColor: entry.type?.appearanceColor ?? null,
        rowKind: 'group',
        depth: 0,
        groupBy: 'resourceType',
      })
      entry.list.forEach((resource) => {
        grouped.push({ ...resource, rowKind: 'resource', depth: 1 })
      })
    }
    if (unassigned.length) {
      grouped.push({
        id: 'group:unassigned',
        name: t('resources.resources.list.group.unassigned', 'Unassigned'),
        resourceTypeId: null,
        areaId: null,
        sortOrder: null,
        appearanceIcon: null,
        appearanceColor: null,
        rowKind: 'group',
        depth: 0,
        groupBy: 'resourceType',
      })
      unassigned.forEach((resource) => {
        grouped.push({ ...resource, rowKind: 'resource', depth: 1 })
      })
    }
    return grouped
  }, [groupBy, resourceAreas, resourceTypes, rows, t])

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
        })
        if (groupBy === 'area') {
          params.set('sortField', 'sortOrder')
          params.set('sortDir', 'asc')
        }
        if (search) params.set('search', search)
        if (selectedResourceTypeId) params.set('resourceTypeId', selectedResourceTypeId)
        if (typeof filterValues.areaId === 'string' && filterValues.areaId.length) {
          params.set('areaId', filterValues.areaId)
        }
        const tagIds = Array.isArray(filterValues.tagIds)
          ? filterValues.tagIds
              .map((value) => (typeof value === 'string' ? value.trim() : String(value || '').trim()))
              .filter((value) => value.length > 0)
          : []
        if (tagIds.length > 0) params.set('tagIds', tagIds.join(','))
        const fallback: ResourcesResponse = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResourcesResponse>(`/api/resources/resources?${params.toString()}`, { signal: controller.signal }, { fallback })
        if (!call.ok) {
          flash(t('resources.resources.list.error.load', 'Failed to load resources.'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          const items = Array.isArray(payload.items) ? payload.items : []
          const mapped = items.map(mapApiResource)
          setRows(mapped)
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : t('resources.resources.list.error.load', 'Failed to load resources.')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true; controller.abort() }
  }, [filterValues, groupBy, page, reloadToken, search, scopeVersion, selectedResourceTypeId, t])

  const handleDelete = React.useCallback(async (row: ResourceTableRow) => {
    if (row.rowKind !== 'resource') return
    const confirmLabel = t('resources.resources.list.confirmDelete', 'Delete resource "{name}"?', { name: row.name })
    const confirmed = await confirm({
      title: confirmLabel,
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      const headers = buildOptimisticLockHeader(row.updatedAt)
      await runResourceMutation(
        () => withScopedApiRequestHeaders(headers, () => (
          deleteCrud('resources/resources', row.id, {
            errorMessage: t('resources.resources.list.error.delete', 'Failed to delete resource.'),
          })
        )),
        { operation: 'deleteResource', id: row.id, updatedAt: row.updatedAt ?? null },
        row.id,
      )
      flash(t('resources.resources.list.flash.deleted', 'Resource deleted.'), 'success')
      setPage(1)
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('resources.resources.list.error.delete', 'Failed to delete resource.')
      flash(message, 'error')
    }
  }, [confirm, router, runResourceMutation, t])

  const columns = React.useMemo<ColumnDef<ResourceTableRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('resources.resources.list.columns.name', 'Resource'),
      meta: { priority: 1 },
      cell: ({ row }) => {
        const depth = row.original.depth ?? 0
        const indent = depth > 0 ? 18 : 0
        const groupRow = row.original.rowKind === 'group' ? row.original : null
        const resourceRow = row.original.rowKind === 'resource' ? row.original : null
        const showEdit = groupRow
          && canManage
          && groupRow.groupBy === 'resourceType'
          && groupRow.resourceTypeId
        return (
          <div
            className={groupRow ? 'flex items-center justify-between gap-3' : 'flex items-center gap-2'}
            onDragOver={(event) => {
              if (!resourceRow || !canReorderResources || !draggingResourceId) return
              event.preventDefault()
            }}
            onDrop={(event) => {
              if (!resourceRow) return
              event.preventDefault()
              handleResourceDrop(resourceRow)
            }}
          >
            <div className="flex min-w-0 items-center gap-2" style={{ marginLeft: indent }}>
              {resourceRow && canManage && groupBy === 'area' ? (
                <div className="flex items-center gap-1" data-actions-cell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 cursor-grab"
                    disabled={!canReorderResources}
                    draggable={canReorderResources}
                    title={t('resources.resources.list.actions.dragToReorder', 'Drag to reorder')}
                    aria-label={t('resources.resources.list.actions.dragToReorder', 'Drag to reorder')}
                    onClick={(event) => event.stopPropagation()}
                    onDragStart={(event) => {
                      event.stopPropagation()
                      setDraggingResourceId(resourceRow.id)
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', resourceRow.id)
                    }}
                    onDragEnd={() => setDraggingResourceId(null)}
                  >
                    <GripVertical className="size-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    title={t('resources.resources.list.actions.moveUp', 'Move up')}
                    aria-label={t('resources.resources.list.actions.moveUp', 'Move up')}
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleReorderResource(resourceRow, { direction: 'up' })
                    }}
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    title={t('resources.resources.list.actions.moveDown', 'Move down')}
                    aria-label={t('resources.resources.list.actions.moveDown', 'Move down')}
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleReorderResource(resourceRow, { direction: 'down' })
                    }}
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </Button>
                </div>
              ) : null}
              <span className={groupRow ? 'text-sm font-semibold text-foreground' : 'min-w-0 truncate text-sm font-medium text-foreground'}>
                {row.original.name}
              </span>
            </div>
            {showEdit ? (
              <Button
                asChild
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title={t('resources.resourceTypes.actions.edit', 'Edit')}
                aria-label={t('resources.resourceTypes.actions.edit', 'Edit')}
              >
                <Link href={`/backend/resources/resource-types/${encodeURIComponent(groupRow.resourceTypeId ?? '')}/edit`}>
                  <Pencil className="h-4 w-4" />
                </Link>
              </Button>
            ) : null}
          </div>
        )
      },
    },
    {
      accessorKey: 'appearance',
      header: t('resources.resources.list.columns.appearance', 'Appearance'),
      meta: { priority: 2 },
      cell: ({ row }) => {
        const isGroup = row.original.rowKind === 'group'
        const typeId = row.original.resourceTypeId ?? ''
        const type = resourceTypes.get(typeId) ?? null
        const icon = isGroup
          ? row.original.appearanceIcon
          : row.original.appearanceIcon ?? type?.appearanceIcon
        const color = isGroup
          ? row.original.appearanceColor
          : row.original.appearanceColor ?? type?.appearanceColor
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
      accessorKey: 'resourceTypeId',
      header: t('resources.resources.list.columns.type', 'Type'),
      meta: { priority: 3 },
      cell: ({ row }) => {
        if (row.original.rowKind === 'group') return null
        return resourceTypes.get(row.original.resourceTypeId ?? '')?.name || t('resources.resources.list.columns.type.empty', 'Unassigned')
      },
    },
    {
      accessorKey: 'areaId',
      header: t('resources.resources.list.columns.area', 'Area'),
      meta: { priority: 4 },
      cell: ({ row }) => {
        if (row.original.rowKind === 'group') return null
        return resourceAreas.get(row.original.areaId ?? '')?.name || t('resources.resources.list.columns.area.empty', '-')
      },
    },
    {
      accessorKey: 'sortOrder',
      header: t('resources.resources.list.columns.sortOrder', 'Order'),
      meta: { priority: 5 },
      cell: ({ row }) => row.original.rowKind === 'group' ? null : row.original.sortOrder,
    },
    {
      accessorKey: 'capacity',
      header: t('resources.resources.list.columns.capacity', 'Capacity'),
      meta: { priority: 5 },
      cell: ({ row }) => row.original.rowKind === 'group'
        ? null
        : row.original.capacity ?? t('resources.resources.list.columns.capacity.empty', '-'),
    },
    {
      accessorKey: 'tags',
      header: t('resources.resources.list.columns.tags', 'Tags'),
      meta: { priority: 6 },
      cell: ({ row }) => {
        if (row.original.rowKind === 'group') {
          return null
        }
        const tags = row.original.tags ?? []
        if (!tags.length) return <span className="text-xs text-muted-foreground">{t('resources.resources.list.columns.tags.empty', '-')}</span>
        return (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span key={tag.id} className="rounded-full border px-2 py-0.5 text-xs font-medium">
                {tag.label}
              </span>
            ))}
          </div>
        )
      },
    },
    {
      accessorKey: 'isActive',
      header: t('resources.resources.list.columns.active', 'Active'),
      meta: { priority: 7 },
      cell: ({ row }) => row.original.rowKind === 'group' ? null : <BooleanIcon value={row.original.isActive} />,
    },
  ], [
    canManage,
    canReorderResources,
    draggingResourceId,
    groupBy,
    handleReorderResource,
    handleResourceDrop,
    resourceTypes,
    resourceAreas,
    t,
  ])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('resources.resources.page.title', 'Resources')}
          actions={canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {t('resources.resources.list.groupBy.label', 'Group by')}
                </span>
                <Select value={groupBy} onValueChange={(value) => setGroupBy(value === 'area' ? 'area' : 'resourceType')}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="resourceType">
                      {t('resources.resources.list.groupBy.resourceType', 'Resource type')}
                    </SelectItem>
                    <SelectItem value="area">
                      {t('resources.resources.list.groupBy.area', 'Area')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button asChild>
                <Link href="/backend/resources/resources/create">{t('resources.resources.list.actions.create', 'New resource')}</Link>
              </Button>
            </div>
          ) : null}
          columns={columns}
          data={groupedRows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          perspective={{ tableId: extensionPoints.hosts.resourcesTable.tableId }}
          rowActions={(row) => {
            if (!canManage || row.rowKind !== 'resource') return null
            return (
              <RowActions items={[
                { id: 'edit', label: t('common.edit', 'Edit'), href: `/backend/resources/resources/${encodeURIComponent(row.id)}` },
                { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
              ]} />
            )
          }}
          onRowClick={canManage ? (row) => {
            if (row.rowKind !== 'resource') return
            router.push(`/backend/resources/resources/${encodeURIComponent(row.id)}`)
          } : undefined}
          emptyState={(
            <ListEmptyState
              entityName={t('resources.resources.page.title', 'Resources')}
              createHref="/backend/resources/resources/create"
              createLabel={t('resources.resources.list.actions.create', 'New resource')}
            />
          )}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}

function mapApiResource(item: Record<string, unknown>): ResourceRow {
  const id = typeof item.id === 'string' ? item.id : ''
  const name = typeof item.name === 'string' ? item.name : id
  const resourceTypeId = typeof item.resourceTypeId === 'string'
    ? item.resourceTypeId
    : typeof item.resource_type_id === 'string'
      ? item.resource_type_id
      : null
  const areaId = typeof item.areaId === 'string'
    ? item.areaId
    : typeof item.area_id === 'string'
      ? item.area_id
      : null
  const capacity = typeof item.capacity === 'number'
    ? item.capacity
    : typeof item.capacity === 'string'
      ? Number(item.capacity)
      : null
  const sortOrder = typeof item.sortOrder === 'number'
    ? item.sortOrder
    : typeof item.sort_order === 'number'
      ? item.sort_order
      : typeof item.sort_order === 'string'
        ? Number(item.sort_order)
        : 0
  const isActive = typeof item.isActive === 'boolean'
    ? item.isActive
    : typeof item.is_active === 'boolean'
      ? item.is_active
      : false
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
  const tags = Array.isArray(item.tags) ? item.tags as TagOption[] : []
  const updatedAt = typeof item.updatedAt === 'string'
    ? item.updatedAt
    : typeof item.updated_at === 'string'
      ? item.updated_at
      : null
  return withDataTableNamespaces({
    id,
    name,
    resourceTypeId,
    areaId,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    capacity: Number.isFinite(capacity as number) ? capacity as number : null,
    tags,
    isActive,
    appearanceIcon,
    appearanceColor,
    updatedAt,
  }, item)
}
