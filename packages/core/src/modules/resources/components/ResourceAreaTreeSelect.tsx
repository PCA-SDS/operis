"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

const logger = createLogger('resources').child({ component: 'ResourceAreaTreeSelect' })
const AREA_TREE_PAGE_SIZE = 100
const ROOT_PARENT_KEY = '__root__'

export type ResourceAreaOption = {
  id: string
  name: string
  parent_area_id?: string | null
  depth?: number
  child_count?: number
  path_label?: string | null
  ancestor_ids?: string[]
}

type ResourceAreasResponse = {
  items?: ResourceAreaOption[]
  total?: number
  totalPages?: number
}

type AreaTreePageState = {
  page: number
  totalPages: number
  total: number
}

type ResourceAreaTreeSelectProps = {
  value?: string | null
  onChange: (value: string | null) => void
  disabled?: boolean
  excludeSubtreeOf?: string | null
  emptyLabel?: string
  loadingErrorLabel?: string
}

function mergeAreaOptions(
  current: ResourceAreaOption[],
  next: ResourceAreaOption[],
  excludeAreaId?: string | null,
): ResourceAreaOption[] {
  const merged = new Map<string, ResourceAreaOption>()
  for (const option of current) {
    if (option.id !== excludeAreaId) merged.set(option.id, option)
  }
  for (const option of next) {
    if (option.id !== excludeAreaId) merged.set(option.id, option)
  }
  return Array.from(merged.values())
}

function formatAreaOptionLabel(area: ResourceAreaOption): string {
  const depth = typeof area.depth === 'number' && area.depth > 0 ? area.depth : 0
  return depth > 0 ? `${'  '.repeat(depth)}↳ ${area.name}` : area.name
}

function getAreaParentKey(parentAreaId: string | null): string {
  return parentAreaId ?? ROOT_PARENT_KEY
}

function mapAreaOptions(items: ResourceAreaOption[], excludeAreaId?: string | null): ResourceAreaOption[] {
  return items.filter((area) => area.id !== excludeAreaId)
}

function findAreaOption(
  rowsByParentId: Map<string, ResourceAreaOption[]>,
  areaId: string | null,
): ResourceAreaOption | null {
  if (!areaId) return null
  for (const rows of rowsByParentId.values()) {
    const found = rows.find((row) => row.id === areaId)
    if (found) return found
  }
  return null
}

function normalizeAreaAncestorIds(area: ResourceAreaOption | null): string[] {
  return Array.isArray(area?.ancestor_ids)
    ? area.ancestor_ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
}

function mergeAreaRowsByParentId(
  rowsByParentId: Map<string, ResourceAreaOption[]>,
  rows: ResourceAreaOption[],
  excludeAreaId?: string | null,
): Map<string, ResourceAreaOption[]> {
  const next = new Map(rowsByParentId)
  for (const row of rows) {
    const parentKey = getAreaParentKey(row.parent_area_id ?? null)
    next.set(parentKey, mergeAreaOptions(next.get(parentKey) ?? [], [row], excludeAreaId))
  }
  return next
}

export function ResourceAreaTreeSelect({
  value,
  onChange,
  disabled,
  excludeSubtreeOf,
  emptyLabel,
  loadingErrorLabel,
}: ResourceAreaTreeSelectProps) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const selectedValue = typeof value === 'string' && value.length > 0 ? value : null
  const noSelectionLabel = emptyLabel ?? t('resources.resourceAreas.form.noParent', 'None')
  const errorLabel = loadingErrorLabel ?? t('resources.resourceAreas.errors.load', 'Failed to load resource areas.')
  const [rowsByParentId, setRowsByParentId] = React.useState<Map<string, ResourceAreaOption[]>>(new Map())
  const [pageByParentId, setPageByParentId] = React.useState<Map<string, AreaTreePageState>>(new Map())
  const [expandedAreaIds, setExpandedAreaIds] = React.useState<Set<string>>(new Set())
  const [loadingParentIds, setLoadingParentIds] = React.useState<Set<string>>(new Set())
  const [loadedParentIds, setLoadedParentIds] = React.useState<Set<string>>(new Set())
  const [selectedArea, setSelectedArea] = React.useState<ResourceAreaOption | null>(null)

  const fetchAreasPage = React.useCallback(async (parentAreaId: string | null, page: number): Promise<ResourceAreasResponse> => {
    const params = new URLSearchParams({
      parentAreaId: parentAreaId ?? 'null',
      page: String(page),
      pageSize: String(AREA_TREE_PAGE_SIZE),
    })
    if (excludeSubtreeOf) params.set('excludeSubtreeOf', excludeSubtreeOf)
    return readApiResultOrThrow<ResourceAreasResponse>(
      `/api/resources/areas?${params.toString()}`,
      undefined,
      { errorMessage: errorLabel },
    )
  }, [errorLabel, excludeSubtreeOf])

  const fetchSelectedArea = React.useCallback(async (areaId: string): Promise<ResourceAreaOption[]> => {
    const params = new URLSearchParams({
      ids: areaId,
      page: '1',
      pageSize: '1',
    })
    const payload = await readApiResultOrThrow<ResourceAreasResponse>(
      `/api/resources/areas?${params.toString()}`,
      undefined,
      { errorMessage: errorLabel },
    )
    return Array.isArray(payload.items) ? payload.items : []
  }, [errorLabel])

  const fetchAreasByIds = React.useCallback(async (areaIds: string[]): Promise<ResourceAreaOption[]> => {
    const ids = Array.from(new Set(areaIds.filter(Boolean)))
    if (ids.length === 0) return []
    const params = new URLSearchParams({
      ids: ids.join(','),
      page: '1',
      pageSize: String(Math.min(ids.length, AREA_TREE_PAGE_SIZE)),
    })
    const payload = await readApiResultOrThrow<ResourceAreasResponse>(
      `/api/resources/areas?${params.toString()}`,
      undefined,
      { errorMessage: errorLabel },
    )
    return Array.isArray(payload.items) ? payload.items : []
  }, [errorLabel])

  React.useEffect(() => {
    let cancelled = false
    async function loadAreas() {
      const rootKey = getAreaParentKey(null)
      try {
        setLoadingParentIds(new Set([rootKey]))
        const payload = await fetchAreasPage(null, 1)
        const firstPageItems = Array.isArray(payload.items) ? payload.items : []
        const selectedItems = selectedValue && !firstPageItems.some((area) => area.id === selectedValue)
          ? await fetchSelectedArea(selectedValue)
          : []
        const selected = mergeAreaOptions([], selectedItems, excludeSubtreeOf)[0] ??
          firstPageItems.find((area) => area.id === selectedValue) ??
          null
        const ancestorIds = normalizeAreaAncestorIds(selected)
        const ancestorItems = await fetchAreasByIds(ancestorIds)
        const ancestorChildPayloads = await Promise.all(ancestorIds.map(async (ancestorId) => ({
          ancestorId,
          payload: await fetchAreasPage(ancestorId, 1),
        })))
        if (cancelled) return
        const rootRows = mapAreaOptions(firstPageItems, excludeSubtreeOf)
        let nextRowsByParentId = new Map([[rootKey, rootRows]])
        const nextPageByParentId = new Map([[rootKey, {
          page: 1,
          totalPages: payload.totalPages ?? 1,
          total: payload.total ?? rootRows.length,
        }]])
        const nextLoadedParentIds = new Set([rootKey])
        for (const { ancestorId, payload: childPayload } of ancestorChildPayloads) {
          const parentKey = getAreaParentKey(ancestorId)
          const childRows = mapAreaOptions(Array.isArray(childPayload.items) ? childPayload.items : [], excludeSubtreeOf)
          nextRowsByParentId.set(parentKey, mergeAreaOptions(nextRowsByParentId.get(parentKey) ?? [], childRows, excludeSubtreeOf))
          nextPageByParentId.set(parentKey, {
            page: 1,
            totalPages: childPayload.totalPages ?? 1,
            total: childPayload.total ?? childRows.length,
          })
          nextLoadedParentIds.add(parentKey)
        }
        nextRowsByParentId = mergeAreaRowsByParentId(
          nextRowsByParentId,
          mergeAreaOptions(ancestorItems, selected ? [selected] : [], excludeSubtreeOf),
          excludeSubtreeOf,
        )
        setRowsByParentId(nextRowsByParentId)
        setPageByParentId(nextPageByParentId)
        setLoadedParentIds(nextLoadedParentIds)
        setExpandedAreaIds(new Set(ancestorIds))
        setSelectedArea(selected ?? rootRows.find((area) => area.id === selectedValue) ?? null)
      } catch (err) {
        if (cancelled) return
        logger.error('Failed to load areas', { err })
        setRowsByParentId(new Map([[rootKey, []]]))
        setPageByParentId(new Map([[rootKey, { page: 1, totalPages: 1, total: 0 }]]))
        setLoadedParentIds(new Set([rootKey]))
        setSelectedArea(null)
      } finally {
        if (!cancelled) setLoadingParentIds(new Set())
      }
    }
    void loadAreas()
    return () => { cancelled = true }
  }, [excludeSubtreeOf, fetchAreasByIds, fetchAreasPage, fetchSelectedArea, scopeVersion, selectedValue])

  const loadAreaChildren = React.useCallback(async (parentAreaId: string | null, page = 1, append = false) => {
    const parentKey = getAreaParentKey(parentAreaId)
    setLoadingParentIds((current) => new Set(current).add(parentKey))
    try {
      const payload = await fetchAreasPage(parentAreaId, page)
      const items = Array.isArray(payload.items) ? payload.items : []
      const mapped = mapAreaOptions(items, excludeSubtreeOf)
      setRowsByParentId((current) => {
        const next = new Map(current)
        const existing = append ? next.get(parentKey) ?? [] : []
        next.set(parentKey, mergeAreaOptions(existing, mapped, excludeSubtreeOf))
        return next
      })
      setPageByParentId((current) => {
        const next = new Map(current)
        next.set(parentKey, {
          page,
          totalPages: payload.totalPages ?? 1,
          total: payload.total ?? mapped.length,
        })
        return next
      })
      setLoadedParentIds((current) => new Set(current).add(parentKey))
    } catch (err) {
      logger.error('Failed to load area tree options', { err, parentAreaId })
    } finally {
      setLoadingParentIds((current) => {
        const next = new Set(current)
        next.delete(parentKey)
        return next
      })
    }
  }, [excludeSubtreeOf, fetchAreasPage])

  const toggleAreaExpanded = React.useCallback((area: ResourceAreaOption) => {
    if ((area.child_count ?? 0) <= 0) return
    setExpandedAreaIds((current) => {
      const next = new Set(current)
      if (next.has(area.id)) {
        next.delete(area.id)
        return next
      }
      next.add(area.id)
      if (!loadedParentIds.has(getAreaParentKey(area.id))) {
        void loadAreaChildren(area.id)
      }
      return next
    })
  }, [loadAreaChildren, loadedParentIds])

  const loadMoreAreaChildren = React.useCallback((parentAreaId: string | null) => {
    const parentKey = getAreaParentKey(parentAreaId)
    const state = pageByParentId.get(parentKey)
    if (!state || state.page >= state.totalPages || loadingParentIds.has(parentKey)) return
    void loadAreaChildren(parentAreaId, state.page + 1, true)
  }, [loadAreaChildren, loadingParentIds, pageByParentId])

  const rows = React.useMemo(() => {
    const output: ResourceAreaOption[] = []
    const appendRows = (parentAreaId: string | null) => {
      const childRows = rowsByParentId.get(getAreaParentKey(parentAreaId)) ?? []
      for (const row of childRows) {
        output.push(row)
        if (expandedAreaIds.has(row.id)) appendRows(row.id)
      }
    }
    appendRows(null)
    return output
  }, [expandedAreaIds, rowsByParentId])

  const selected = findAreaOption(rowsByParentId, selectedValue) ?? selectedArea
  const selectedLabel = selected
    ? selected.path_label ?? formatAreaOptionLabel(selected)
    : noSelectionLabel
  const rootState = pageByParentId.get(ROOT_PARENT_KEY)
  const rootLoading = loadingParentIds.has(ROOT_PARENT_KEY)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between"
          disabled={disabled || rootLoading}
        >
          <span className="truncate">{selectedLabel}</span>
          {rootLoading ? <Loader2 className="size-4 animate-spin" /> : <ChevronDown className="size-4" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-1">
        <div className="max-h-80 overflow-auto">
          <Button
            type="button"
            variant="ghost"
            className={`w-full justify-start ${selectedValue ? '' : 'bg-surface-strong text-foreground'}`}
            onClick={() => {
              setSelectedArea(null)
              onChange(null)
            }}
          >
            <span>{noSelectionLabel}</span>
          </Button>
          {rows.map((area) => {
            const hasChildren = (area.child_count ?? 0) > 0
            const expanded = expandedAreaIds.has(area.id)
            const parentKey = getAreaParentKey(area.id)
            const childrenLoading = loadingParentIds.has(parentKey)
            const pageState = pageByParentId.get(parentKey)
            const canLoadMore = Boolean(pageState && pageState.page < pageState.totalPages)
            const isSelected = selectedValue === area.id
            return (
              <React.Fragment key={area.id}>
                <div className="flex items-center gap-1" style={{ paddingLeft: `${Math.max(area.depth ?? 0, 0) * 16}px` }}>
                  {hasChildren || childrenLoading ? (
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="size-5"
                      aria-label={expanded
                        ? t('resources.resourceAreas.actions.collapse', 'Collapse area')
                        : t('resources.resourceAreas.actions.expand', 'Expand area')}
                      disabled={childrenLoading}
                      onClick={() => toggleAreaExpanded(area)}
                    >
                      {childrenLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : expanded ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </IconButton>
                  ) : (
                    <span className="size-5 shrink-0" aria-hidden="true" />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    className={`min-w-0 flex-1 justify-start ${isSelected ? 'bg-surface-strong text-foreground' : ''}`}
                    onClick={() => {
                      setSelectedArea(area)
                      onChange(area.id)
                    }}
                  >
                    <span className="truncate">{area.name}</span>
                  </Button>
                </div>
                {canLoadMore ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => loadMoreAreaChildren(area.id)}
                  >
                    {t('resources.resourceAreas.form.loadingMore', 'Load more...')}
                  </Button>
                ) : null}
              </React.Fragment>
            )
          })}
          {rootState && rootState.page < rootState.totalPages ? (
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              onClick={() => loadMoreAreaChildren(null)}
            >
              {t('resources.resourceAreas.form.loadingMore', 'Load more...')}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
