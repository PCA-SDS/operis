"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { E } from '#generated/entities.ids.generated'
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@open-mercato/ui/primitives/select'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

const logger = createLogger('resources').child({ component: 'ResourceAreaCrudForm' })
const PARENT_AREA_PAGE_SIZE = 100
const AREA_TYPE_PAGE_SIZE = 100
const ROOT_PARENT_KEY = '__root__'

export type ResourceAreaFormValues = {
  id?: string
  name: string
  description?: string
  areaTypeId?: string | null
  parentAreaId?: string | null
  sortOrder?: number
  appearance?: { icon?: string | null; color?: string | null }
  isActive?: boolean
  updatedAt?: string | null
}

type AreaTypeOption = {
  id: string
  name: string
  appearanceIcon?: string | null
  appearanceColor?: string | null
}

type AreaTypesResponse = {
  items?: AreaTypeOption[]
}

type ResourceAreaCrudFormProps = {
  mode: 'create' | 'edit'
  initialValues: ResourceAreaFormValues
  isLoading?: boolean
  onSubmit: (values: ResourceAreaFormValues) => Promise<void>
  onDelete?: () => Promise<void>
  deleteVisible?: boolean
}

type ResourceAreaOption = {
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

async function fetchAreaTypes(): Promise<AreaTypeOption[]> {
  try {
    const params = new URLSearchParams({ page: '1', pageSize: String(AREA_TYPE_PAGE_SIZE) })
    const payload = await readApiResultOrThrow<AreaTypesResponse>(
      `/api/resources/area-types?${params.toString()}`,
    )
    return Array.isArray(payload.items) ? payload.items : []
  } catch {
    return []
  }
}

function mergeAreaOptions(
  current: ResourceAreaOption[],
  next: ResourceAreaOption[],
  currentAreaId?: string,
): ResourceAreaOption[] {
  const merged = new Map<string, ResourceAreaOption>()
  for (const option of current) {
    if (option.id !== currentAreaId) merged.set(option.id, option)
  }
  for (const option of next) {
    if (option.id !== currentAreaId) merged.set(option.id, option)
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

function mapAreaOptions(items: ResourceAreaOption[], currentAreaId?: string): ResourceAreaOption[] {
  return items.filter((area) => area.id !== currentAreaId)
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
  currentAreaId?: string,
): Map<string, ResourceAreaOption[]> {
  const next = new Map(rowsByParentId)
  for (const row of rows) {
    const parentKey = getAreaParentKey(row.parent_area_id ?? null)
    next.set(parentKey, mergeAreaOptions(next.get(parentKey) ?? [], [row], currentAreaId))
  }
  return next
}

export const buildResourceAreaPayload = (
  values: ResourceAreaFormValues,
  options: { id?: string } = {},
): Record<string, unknown> => {
  const name = typeof values.name === 'string' ? values.name.trim() : ''
  const description = typeof values.description === 'string' && values.description.trim().length
    ? values.description.trim()
    : null
  const appearance = values.appearance && typeof values.appearance === 'object'
    ? values.appearance as { icon?: string | null; color?: string | null }
    : {}

  return {
    ...(options.id ? { id: options.id } : {}),
    name,
    description,
    areaTypeId: values.areaTypeId || null,
    parentAreaId: values.parentAreaId || null,
    appearanceIcon: appearance.icon ?? null,
    appearanceColor: appearance.color ?? null,
    isActive: typeof values.isActive === 'boolean' ? values.isActive : true,
  }
}

export function ResourceAreaCrudForm({
  mode,
  initialValues,
  isLoading,
  onSubmit,
  onDelete,
  deleteVisible,
}: ResourceAreaCrudFormProps) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [areaTypes, setAreaTypes] = React.useState<AreaTypeOption[]>([])
  const [areaTypesLoading, setAreaTypesLoading] = React.useState(true)
  const [areaTreeRowsByParentId, setAreaTreeRowsByParentId] = React.useState<Map<string, ResourceAreaOption[]>>(new Map())
  const [areaTreePageByParentId, setAreaTreePageByParentId] = React.useState<Map<string, AreaTreePageState>>(new Map())
  const [expandedAreaIds, setExpandedAreaIds] = React.useState<Set<string>>(new Set())
  const [loadingAreaParentIds, setLoadingAreaParentIds] = React.useState<Set<string>>(new Set())
  const [loadedAreaParentIds, setLoadedAreaParentIds] = React.useState<Set<string>>(new Set())
  const [selectedParentArea, setSelectedParentArea] = React.useState<ResourceAreaOption | null>(null)

  const fetchAreasPage = React.useCallback(async (parentAreaId: string | null, page: number): Promise<ResourceAreasResponse> => {
    const params = new URLSearchParams({
      parentAreaId: parentAreaId ?? 'null',
      page: String(page),
      pageSize: String(PARENT_AREA_PAGE_SIZE),
    })
    if (initialValues.id) params.set('excludeSubtreeOf', initialValues.id)
    return readApiResultOrThrow<ResourceAreasResponse>(
      `/api/resources/areas?${params.toString()}`,
      undefined,
      { errorMessage: t('resources.resourceAreas.errors.load', 'Failed to load resource areas.') },
    )
  }, [initialValues.id, t])

  const fetchSelectedParentArea = React.useCallback(async (parentAreaId: string): Promise<ResourceAreaOption[]> => {
    const params = new URLSearchParams({
      ids: parentAreaId,
      page: '1',
      pageSize: '1',
    })
    const payload = await readApiResultOrThrow<ResourceAreasResponse>(
      `/api/resources/areas?${params.toString()}`,
      undefined,
      { errorMessage: t('resources.resourceAreas.errors.load', 'Failed to load resource areas.') },
    )
    return Array.isArray(payload.items) ? payload.items : []
  }, [t])

  const fetchAreasByIds = React.useCallback(async (areaIds: string[]): Promise<ResourceAreaOption[]> => {
    const ids = Array.from(new Set(areaIds.filter(Boolean)))
    if (ids.length === 0) return []
    const params = new URLSearchParams({
      ids: ids.join(','),
      page: '1',
      pageSize: String(Math.min(ids.length, PARENT_AREA_PAGE_SIZE)),
    })
    const payload = await readApiResultOrThrow<ResourceAreasResponse>(
      `/api/resources/areas?${params.toString()}`,
      undefined,
      { errorMessage: t('resources.resourceAreas.errors.load', 'Failed to load resource areas.') },
    )
    return Array.isArray(payload.items) ? payload.items : []
  }, [t])

  React.useEffect(() => {
    let cancelled = false
    async function loadAreaTypes() {
      try {
        const types = await fetchAreaTypes()
        if (cancelled) return
        setAreaTypes(types)
      } catch {
        // non-critical — leave empty
      } finally {
        if (!cancelled) setAreaTypesLoading(false)
      }
    }
    void loadAreaTypes()
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    async function loadAreas() {
      const rootKey = getAreaParentKey(null)
      try {
        setLoadingAreaParentIds(new Set([rootKey]))
        const payload = await fetchAreasPage(null, 1)
        const firstPageItems = Array.isArray(payload.items) ? payload.items : []
        const selectedParentItems = initialValues.parentAreaId &&
          !firstPageItems.some((area) => area.id === initialValues.parentAreaId)
          ? await fetchSelectedParentArea(initialValues.parentAreaId)
          : []
        const selected = mergeAreaOptions([], selectedParentItems, initialValues.id)[0] ??
          firstPageItems.find((area) => area.id === initialValues.parentAreaId) ??
          null
        const ancestorIds = normalizeAreaAncestorIds(selected)
        const ancestorItems = await fetchAreasByIds(ancestorIds)
        const ancestorChildPayloads = await Promise.all(ancestorIds.map(async (ancestorId) => ({
          ancestorId,
          payload: await fetchAreasPage(ancestorId, 1),
        })))
        if (cancelled) return
        const rootRows = mapAreaOptions(firstPageItems, initialValues.id)
        let rowsByParentId = new Map([[rootKey, rootRows]])
        const pageByParentId = new Map([[rootKey, {
          page: 1,
          totalPages: payload.totalPages ?? 1,
          total: payload.total ?? rootRows.length,
        }]])
        const loadedParentIds = new Set([rootKey])
        for (const { ancestorId, payload: childPayload } of ancestorChildPayloads) {
          const parentKey = getAreaParentKey(ancestorId)
          const childRows = mapAreaOptions(Array.isArray(childPayload.items) ? childPayload.items : [], initialValues.id)
          rowsByParentId.set(parentKey, mergeAreaOptions(rowsByParentId.get(parentKey) ?? [], childRows, initialValues.id))
          pageByParentId.set(parentKey, {
            page: 1,
            totalPages: childPayload.totalPages ?? 1,
            total: childPayload.total ?? childRows.length,
          })
          loadedParentIds.add(parentKey)
        }
        rowsByParentId = mergeAreaRowsByParentId(
          rowsByParentId,
          mergeAreaOptions(ancestorItems, selected ? [selected] : [], initialValues.id),
          initialValues.id,
        )
        setAreaTreeRowsByParentId(rowsByParentId)
        setAreaTreePageByParentId(pageByParentId)
        setLoadedAreaParentIds(loadedParentIds)
        setExpandedAreaIds(new Set(ancestorIds))
        setSelectedParentArea(selected ?? rootRows.find((area) => area.id === initialValues.parentAreaId) ?? null)
      } catch (err) {
        if (cancelled) return
        logger.error('Failed to load areas', { err })
        setAreaTreeRowsByParentId(new Map([[rootKey, []]]))
        setAreaTreePageByParentId(new Map([[rootKey, { page: 1, totalPages: 1, total: 0 }]]))
        setLoadedAreaParentIds(new Set([rootKey]))
        setSelectedParentArea(null)
      } finally {
        if (!cancelled) setLoadingAreaParentIds(new Set())
      }
    }
    void loadAreas()
    return () => {
      cancelled = true
    }
  }, [fetchAreasByIds, fetchAreasPage, fetchSelectedParentArea, initialValues.id, initialValues.parentAreaId, scopeVersion])

  const loadAreaChildren = React.useCallback(async (parentAreaId: string | null, page = 1, append = false) => {
    const parentKey = getAreaParentKey(parentAreaId)
    setLoadingAreaParentIds((current) => new Set(current).add(parentKey))
    try {
      const payload = await fetchAreasPage(parentAreaId, page)
      const items = Array.isArray(payload.items) ? payload.items : []
      const mapped = mapAreaOptions(items, initialValues.id)
      setAreaTreeRowsByParentId((current) => {
        const next = new Map(current)
        const existing = append ? next.get(parentKey) ?? [] : []
        next.set(parentKey, mergeAreaOptions(existing, mapped, initialValues.id))
        return next
      })
      setAreaTreePageByParentId((current) => {
        const next = new Map(current)
        next.set(parentKey, {
          page,
          totalPages: payload.totalPages ?? 1,
          total: payload.total ?? mapped.length,
        })
        return next
      })
      setLoadedAreaParentIds((current) => new Set(current).add(parentKey))
    } catch (err) {
      logger.error('Failed to load area tree options', { err, parentAreaId })
    } finally {
      setLoadingAreaParentIds((current) => {
        const next = new Set(current)
        next.delete(parentKey)
        return next
      })
    }
  }, [fetchAreasPage, initialValues.id])

  const toggleAreaExpanded = React.useCallback((area: ResourceAreaOption) => {
    if ((area.child_count ?? 0) <= 0) return
    setExpandedAreaIds((current) => {
      const next = new Set(current)
      if (next.has(area.id)) {
        next.delete(area.id)
        return next
      }
      next.add(area.id)
      if (!loadedAreaParentIds.has(getAreaParentKey(area.id))) {
        void loadAreaChildren(area.id)
      }
      return next
    })
  }, [loadAreaChildren, loadedAreaParentIds])

  const loadMoreAreaChildren = React.useCallback((parentAreaId: string | null) => {
    const parentKey = getAreaParentKey(parentAreaId)
    const state = areaTreePageByParentId.get(parentKey)
    if (!state || state.page >= state.totalPages || loadingAreaParentIds.has(parentKey)) return
    void loadAreaChildren(parentAreaId, state.page + 1, true)
  }, [areaTreePageByParentId, loadAreaChildren, loadingAreaParentIds])

  const areaTreeRows = React.useMemo(() => {
    const output: ResourceAreaOption[] = []
    const appendRows = (parentAreaId: string | null) => {
      const rows = areaTreeRowsByParentId.get(getAreaParentKey(parentAreaId)) ?? []
      for (const row of rows) {
        output.push(row)
        if (expandedAreaIds.has(row.id)) appendRows(row.id)
      }
    }
    appendRows(null)
    return output
  }, [areaTreeRowsByParentId, expandedAreaIds])

  const appearanceLabels = React.useMemo(() => ({
    colorLabel: t('resources.resourceAreas.form.appearance.colorLabel', 'Color'),
    colorHelp: t('resources.resourceAreas.form.appearance.colorHelp', 'Pick a color for this resource area.'),
    colorClearLabel: t('resources.resourceAreas.form.appearance.colorClear', 'Clear color'),
    iconLabel: t('resources.resourceAreas.form.appearance.iconLabel', 'Icon'),
    iconPlaceholder: t('resources.resourceAreas.form.appearance.iconPlaceholder', 'Type an emoji or icon name'),
    iconPickerTriggerLabel: t('resources.resourceAreas.form.appearance.iconPicker', 'Browse icons'),
    iconSearchPlaceholder: t('resources.resourceAreas.form.appearance.iconSearch', 'Search icons or emojis…'),
    iconSearchEmptyLabel: t('resources.resourceAreas.form.appearance.iconSearchEmpty', 'No icons match your search'),
    iconSuggestionsLabel: t('resources.resourceAreas.form.appearance.iconSuggestions', 'Suggestions'),
    iconClearLabel: t('resources.resourceAreas.form.appearance.iconClear', 'Clear icon'),
    previewEmptyLabel: t('resources.resourceAreas.form.appearance.previewEmpty', 'No appearance selected'),
  }), [t])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('resources.resourceAreas.form.name', 'Name'), type: 'text', required: true },
    { id: 'description', label: t('resources.resourceAreas.form.description', 'Description'), type: 'richtext', editor: 'uiw' },
    {
      id: 'areaTypeId',
      label: t('resources.resourceAreas.form.areaType', 'Area Type'),
      type: 'custom',
      component: ({ value, setValue, disabled }) => {
        React.useEffect(() => {
          if (initialValues?.areaTypeId && value !== initialValues.areaTypeId) {
            setValue(initialValues.areaTypeId)
          }
        }, [initialValues?.areaTypeId, value, setValue])
        const val = typeof value === 'string' && value ? value : ''
        const selectKey = `${areaTypesLoading ? 'loading' : 'loaded'}-${val}`
        return (
          <Select key={selectKey} disabled={disabled || areaTypesLoading} value={val} onValueChange={setValue}>
            <SelectTrigger><SelectValue placeholder={t('resources.resourceAreas.form.areaTypePlaceholder', 'Select an area type...')} /></SelectTrigger>
            <SelectContent>
              {areaTypesLoading ? (
                <SelectItem value="__loading" disabled>{t('resources.resourceAreas.form.loading', 'Loading…')}</SelectItem>
              ) : areaTypes.map(at => (
                <SelectItem key={at.id} value={at.id}>
                  <span className="flex items-center gap-1.5">
                    {at.appearanceIcon && <span>{at.appearanceIcon}</span>}
                    <span>{at.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }
    },
    {
      id: 'parentAreaId',
      label: t('resources.resourceAreas.form.parentArea', 'Parent Area'),
      type: 'custom',
      component: ({ value, setValue, disabled }) => {
        React.useEffect(() => {
          if (initialValues?.parentAreaId && value !== initialValues.parentAreaId && value !== 'none') {
            setValue(initialValues.parentAreaId)
          }
        }, [initialValues?.parentAreaId, value, setValue])
        const selectedValue = typeof value === 'string' && value ? value : null
        const selected = findAreaOption(areaTreeRowsByParentId, selectedValue) ?? selectedParentArea
        const selectedLabel = selected
          ? selected.path_label ?? formatAreaOptionLabel(selected)
          : t('resources.resourceAreas.form.noParent', 'None')
        const rootState = areaTreePageByParentId.get(ROOT_PARENT_KEY)
        const rootLoading = loadingAreaParentIds.has(ROOT_PARENT_KEY)
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
                    setSelectedParentArea(null)
                    setValue(null)
                  }}
                >
                  <span>{t('resources.resourceAreas.form.noParent', 'None')}</span>
                </Button>
                {areaTreeRows.map((area) => {
                  const hasChildren = (area.child_count ?? 0) > 0
                  const expanded = expandedAreaIds.has(area.id)
                  const parentKey = getAreaParentKey(area.id)
                  const childrenLoading = loadingAreaParentIds.has(parentKey)
                  const pageState = areaTreePageByParentId.get(parentKey)
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
                          <span className="size-7 shrink-0" aria-hidden="true" />
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          className={`min-w-0 flex-1 justify-start ${isSelected ? 'bg-surface-strong text-foreground' : ''}`}
                          onClick={() => {
                            setSelectedParentArea(area)
                            setValue(area.id)
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
    },
    { id: 'isActive', label: t('resources.resourceAreas.form.isActive', 'Is Active'), type: 'checkbox' },
    {
      id: 'appearance',
      label: t('resources.resourceAreas.form.appearance.label', 'Appearance'),
      type: 'custom',
      component: ({ value, setValue }) => {
        const current = value && typeof value === 'object' ? (value as { icon?: string | null; color?: string | null }) : {}
        return (
          <AppearanceSelector
            icon={current.icon ?? null}
            color={current.color ?? null}
            onIconChange={(next) => setValue({ ...current, icon: next })}
            onColorChange={(next) => setValue({ ...current, color: next })}
            labels={appearanceLabels}
          />
        )
      },
    },
  ], [
    appearanceLabels,
    areaTreePageByParentId,
    areaTreeRows,
    areaTreeRowsByParentId,
    areaTypes,
    areaTypesLoading,
    expandedAreaIds,
    initialValues.areaTypeId,
    initialValues.id,
    initialValues.parentAreaId,
    loadMoreAreaChildren,
    loadedAreaParentIds,
    loadingAreaParentIds,
    selectedParentArea,
    t,
    toggleAreaExpanded,
  ])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'details', fields: ['name', 'description', 'areaTypeId', 'parentAreaId', 'isActive'] },
    { id: 'appearance', fields: ['appearance'], column: 2 },
  ], [])

  return (
    <CrudForm<ResourceAreaFormValues>
      title={mode === 'create'
        ? t('resources.resourceAreas.form.createTitle', 'Add Resource Area')
        : t('resources.resourceAreas.form.editTitle', 'Edit Resource Area')}
      backHref="/backend/resources/areas"
      versionHistory={mode === 'edit'
        ? { resourceKind: 'resources.resourceArea', resourceId: initialValues.id ?? '' }
        : undefined}
      cancelHref="/backend/resources/areas"
      submitLabel={t('resources.resourceAreas.form.save', 'Save')}
      fields={fields}
      groups={groups}
      entityId={E.resources.resources_resource_area}
      initialValues={initialValues}
      optimisticLockUpdatedAt={mode === 'edit' ? initialValues.updatedAt : undefined}
      isLoading={isLoading}
      onSubmit={onSubmit}
      onDelete={mode === 'edit' ? onDelete : undefined}
      deleteVisible={typeof deleteVisible === 'boolean' ? deleteVisible : mode === 'edit'}
    />
  )
}
