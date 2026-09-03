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

const logger = createLogger('resources').child({ component: 'ResourceAreaCrudForm' })
const PARENT_AREA_PAGE_SIZE = 100
const PARENT_AREA_SCROLL_THRESHOLD_PX = 48

export type ResourceAreaFormValues = {
  id?: string
  name: string
  description?: string
  areaType?: string
  parentAreaId?: string | null
  sortOrder?: number
  appearance?: { icon?: string | null; color?: string | null }
  isActive?: boolean
  updatedAt?: string | null
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
  depth?: number
}

type ResourceAreasResponse = {
  items?: ResourceAreaOption[]
  totalPages?: number
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
    areaType: values.areaType || 'other',
    parentAreaId: values.parentAreaId || null,
    sortOrder: typeof values.sortOrder === 'number' ? values.sortOrder : 0,
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
  const [areas, setAreas] = React.useState<ResourceAreaOption[]>([])
  const [areasLoading, setAreasLoading] = React.useState(true)
  const [areasLoadingMore, setAreasLoadingMore] = React.useState(false)
  const [areasPage, setAreasPage] = React.useState(1)
  const [areasTotalPages, setAreasTotalPages] = React.useState(1)
  const areasLoadingMoreRef = React.useRef(false)

  const fetchAreasPage = React.useCallback(async (page: number): Promise<ResourceAreasResponse> => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PARENT_AREA_PAGE_SIZE),
    })
    return readApiResultOrThrow<ResourceAreasResponse>(
      `/api/resources/areas?${params.toString()}`,
      undefined,
      { errorMessage: t('resources.resourceAreas.errors.load', 'Failed to load resource areas.') },
    )
  }, [t])

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

  React.useEffect(() => {
    let cancelled = false
    async function loadAreas() {
      try {
        setAreasLoading(true)
        setAreasLoadingMore(false)
        areasLoadingMoreRef.current = false
        const payload = await fetchAreasPage(1)
        const firstPageItems = Array.isArray(payload.items) ? payload.items : []
        const selectedParentItems = initialValues.parentAreaId &&
          !firstPageItems.some((area) => area.id === initialValues.parentAreaId)
          ? await fetchSelectedParentArea(initialValues.parentAreaId)
          : []
        if (cancelled) return
        setAreas(mergeAreaOptions(selectedParentItems, firstPageItems, initialValues.id))
        setAreasPage(1)
        setAreasTotalPages(payload.totalPages ?? 1)
      } catch (err) {
        if (cancelled) return
        logger.error('Failed to load areas', { err })
        setAreas([])
        setAreasPage(1)
        setAreasTotalPages(1)
      } finally {
        if (!cancelled) setAreasLoading(false)
      }
    }
    void loadAreas()
    return () => {
      cancelled = true
    }
  }, [fetchAreasPage, fetchSelectedParentArea, initialValues.id, initialValues.parentAreaId, scopeVersion])

  const loadMoreAreas = React.useCallback(async () => {
    if (areasLoading || areasLoadingMoreRef.current || areasPage >= areasTotalPages) return
    const nextPage = areasPage + 1
    try {
      areasLoadingMoreRef.current = true
      setAreasLoadingMore(true)
      const payload = await fetchAreasPage(nextPage)
      const items = Array.isArray(payload.items) ? payload.items : []
      setAreas((current) => mergeAreaOptions(current, items, initialValues.id))
      setAreasPage(nextPage)
      setAreasTotalPages(payload.totalPages ?? areasTotalPages)
    } catch (err) {
      logger.error('Failed to load more areas', { err })
    } finally {
      areasLoadingMoreRef.current = false
      setAreasLoadingMore(false)
    }
  }, [areasLoading, areasPage, areasTotalPages, fetchAreasPage, initialValues.id])

  const handleAreasViewportScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget
    const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    if (remaining <= PARENT_AREA_SCROLL_THRESHOLD_PX) {
      void loadMoreAreas()
    }
  }, [loadMoreAreas])

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
      id: 'areaType',
      label: t('resources.resourceAreas.form.areaType', 'Area Type'),
      type: 'custom',
      component: ({ value, setValue, disabled }) => {
        React.useEffect(() => {
          if (initialValues?.areaType && value !== initialValues.areaType) {
            setValue(initialValues.areaType)
          }
        }, [initialValues?.areaType, value, setValue])
        const val = typeof value === 'string' && value ? value : 'other'
        const selectKey = `areaType-${val}`
        return (
          <Select key={selectKey} disabled={disabled} value={val} onValueChange={setValue}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="campus">{t('resources.resourceAreas.types.campus', 'Campus')}</SelectItem>
              <SelectItem value="building">{t('resources.resourceAreas.types.building', 'Building')}</SelectItem>
              <SelectItem value="floor">{t('resources.resourceAreas.types.floor', 'Floor')}</SelectItem>
              <SelectItem value="zone">{t('resources.resourceAreas.types.zone', 'Zone')}</SelectItem>
              <SelectItem value="room">{t('resources.resourceAreas.types.room', 'Room')}</SelectItem>
              <SelectItem value="section">{t('resources.resourceAreas.types.section', 'Section')}</SelectItem>
              <SelectItem value="other">{t('resources.resourceAreas.types.other', 'Other')}</SelectItem>
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
        const val = typeof value === 'string' && value ? value : 'none'
        const selectKey = `${areasLoading ? 'loading' : 'loaded'}-${val}`
        return (
          <Select key={selectKey} disabled={disabled || areasLoading} value={val} onValueChange={(v) => setValue(v === 'none' ? null : v)}>
            <SelectTrigger>
              <SelectValue placeholder={t('resources.resourceAreas.form.parentAreaPlaceholder', 'Select a parent area...')} />
            </SelectTrigger>
            <SelectContent viewportProps={{ onScroll: handleAreasViewportScroll }}>
              <SelectItem value="none">-- {t('resources.resourceAreas.form.noParent', 'None')} --</SelectItem>
              {areas.map(a => (
                <SelectItem key={a.id} value={a.id}>
                  <span className="whitespace-pre">{formatAreaOptionLabel(a)}</span>
                </SelectItem>
              ))}
              {areasLoadingMore ? (
                <SelectItem value="__loading_more" disabled>
                  {t('resources.resourceAreas.form.loadingMore', 'Loading more...')}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        )
      }
    },
    { id: 'sortOrder', label: t('resources.resourceAreas.form.sortOrder', 'Sort Order'), type: 'number' },
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
  ], [appearanceLabels, areas, areasLoading, areasLoadingMore, handleAreasViewportScroll, initialValues.areaType, initialValues.id, initialValues.parentAreaId, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'details', fields: ['name', 'description', 'areaType', 'parentAreaId', 'sortOrder', 'isActive'] },
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
