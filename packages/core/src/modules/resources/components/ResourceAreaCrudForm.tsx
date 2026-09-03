"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { E } from '#generated/entities.ids.generated'
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@open-mercato/ui/primitives/select'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

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
    areaType: values.areaType ?? 'other',
    parentAreaId: values.parentAreaId ?? null,
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
  const [areas, setAreas] = React.useState<{ id: string; name: string }[]>([])
  const [areasLoading, setAreasLoading] = React.useState(true)

  React.useEffect(() => {
    async function loadAreas() {
      try {
        setAreasLoading(true)
        const payload = await readApiResultOrThrow<{ items: { id: string; name: string }[] }>(
          '/api/resources/areas?pageSize=1000'
        )
        // filter out itself to prevent circular dependency at basic UI level
        const items = (payload.items || []).filter(a => a.id !== initialValues.id)
        setAreas(items)
      } catch (err) {
        console.error('Failed to load areas', err)
      } finally {
        setAreasLoading(false)
      }
    }
    void loadAreas()
  }, [scopeVersion, initialValues.id])

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
        const val = typeof value === 'string' ? value : 'other'
        return (
          <Select disabled={disabled} value={val} onValueChange={setValue}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="building">{t('resources.resourceAreas.types.building', 'Building')}</SelectItem>
              <SelectItem value="floor">{t('resources.resourceAreas.types.floor', 'Floor')}</SelectItem>
              <SelectItem value="zone">{t('resources.resourceAreas.types.zone', 'Zone')}</SelectItem>
              <SelectItem value="room">{t('resources.resourceAreas.types.room', 'Room')}</SelectItem>
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
        const val = typeof value === 'string' && value ? value : 'none'
        return (
          <Select disabled={disabled || areasLoading} value={val} onValueChange={(v) => setValue(v === 'none' ? null : v)}>
            <SelectTrigger><SelectValue placeholder="Select a parent area..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">-- {t('resources.resourceAreas.form.noParent', 'None')} --</SelectItem>
              {areas.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
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
  ], [appearanceLabels, areas, areasLoading, t])

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
