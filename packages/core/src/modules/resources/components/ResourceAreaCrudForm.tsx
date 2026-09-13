"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { E } from '#generated/entities.ids.generated'
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@open-mercato/ui/primitives/select'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { ResourceAreaTreeSelect } from '@open-mercato/core/modules/resources/components/ResourceAreaTreeSelect'

const AREA_TYPE_PAGE_SIZE = 100

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
  const [areaTypes, setAreaTypes] = React.useState<AreaTypeOption[]>([])
  const [areaTypesLoading, setAreaTypesLoading] = React.useState(true)

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
        return (
          <ResourceAreaTreeSelect
            value={selectedValue}
            onChange={setValue}
            disabled={disabled}
            excludeSubtreeOf={initialValues.id}
            emptyLabel={t('resources.resourceAreas.form.noParent', 'None')}
            loadingErrorLabel={t('resources.resourceAreas.errors.load', 'Failed to load resource areas.')}
          />
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
    areaTypes,
    areaTypesLoading,
    initialValues.areaTypeId,
    initialValues.id,
    initialValues.parentAreaId,
    t,
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
