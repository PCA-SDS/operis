"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { normalizeCustomFieldValues } from '@open-mercato/shared/lib/custom-fields/normalize'
import { E } from '#generated/entities.ids.generated'
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type AreaTypeFormValues = {
  id?: string
  name: string
  description?: string
  isActive?: boolean
  appearance?: { icon?: string | null; color?: string | null }
  updatedAt?: string | null
} & Record<string, unknown>

type AreaTypeCrudFormProps = {
  mode: 'create' | 'edit'
  initialValues: AreaTypeFormValues
  isLoading?: boolean
  onSubmit: (values: AreaTypeFormValues) => Promise<void>
  onDelete?: () => Promise<void>
  deleteVisible?: boolean
}

const normalizeCustomFieldSubmitValue = (value: unknown): unknown => {
  const normalized = normalizeCustomFieldValues({ value })
  return normalized.value
}

export const buildAreaTypePayload = (
  values: AreaTypeFormValues,
  options: { id?: string } = {},
): Record<string, unknown> => {
  const name = typeof values.name === 'string' ? values.name.trim() : ''
  const description = typeof values.description === 'string' && values.description.trim().length
    ? values.description.trim()
    : null
  const appearance = values.appearance && typeof values.appearance === 'object'
    ? (values.appearance as { icon?: string | null; color?: string | null })
    : {}
  const customFields = collectCustomFieldValues(values, { transform: normalizeCustomFieldSubmitValue })

  return {
    ...(options.id ? { id: options.id } : {}),
    name,
    description,
    isActive: values.isActive ?? true,
    appearanceIcon: appearance.icon ?? null,
    appearanceColor: appearance.color ?? null,
    ...(Object.keys(customFields).length ? { customFields } : {}),
  }
}

export function AreaTypeCrudForm({
  mode,
  initialValues,
  isLoading,
  onSubmit,
  onDelete,
  deleteVisible,
}: AreaTypeCrudFormProps) {
  const t = useT()

  const appearanceLabels = React.useMemo(() => ({
    colorLabel: t('resources.areaTypes.form.appearance.colorLabel', 'Color'),
    colorHelp: t('resources.areaTypes.form.appearance.colorHelp', 'Pick a color for this area type.'),
    colorClearLabel: t('resources.areaTypes.form.appearance.colorClear', 'Clear color'),
    iconLabel: t('resources.areaTypes.form.appearance.iconLabel', 'Icon'),
    iconPlaceholder: t('resources.areaTypes.form.appearance.iconPlaceholder', 'Type an emoji or icon name'),
    iconPickerTriggerLabel: t('resources.areaTypes.form.appearance.iconPicker', 'Browse icons'),
    iconSearchPlaceholder: t('resources.areaTypes.form.appearance.iconSearch', 'Search icons or emojis…'),
    iconSearchEmptyLabel: t('resources.areaTypes.form.appearance.iconSearchEmpty', 'No icons match your search'),
    iconSuggestionsLabel: t('resources.areaTypes.form.appearance.iconSuggestions', 'Suggestions'),
    iconClearLabel: t('resources.areaTypes.form.appearance.iconClear', 'Clear icon'),
    previewEmptyLabel: t('resources.areaTypes.form.appearance.previewEmpty', 'No appearance selected'),
  }), [t])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('resources.areaTypes.form.name', 'Name'), type: 'text', required: true },
    { id: 'description', label: t('resources.areaTypes.form.description', 'Description'), type: 'richtext', editor: 'uiw' },
    {
      id: 'appearance',
      label: t('resources.areaTypes.form.appearance.label', 'Appearance'),
      type: 'custom',
      component: ({ value, setValue }) => {
        const current = value && typeof value === 'object'
          ? (value as { icon?: string | null; color?: string | null })
          : {}
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
  ], [appearanceLabels, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'details', fields: ['name', 'description', 'appearance'] },
    { id: 'custom', title: t('entities.customFields.title', 'Custom Attributes'), column: 2, kind: 'customFields' },
  ], [t])

  return (
    <CrudForm<AreaTypeFormValues>
      title={mode === 'create'
        ? t('resources.areaTypes.form.createTitle', 'Add Area Type')
        : t('resources.areaTypes.form.editTitle', 'Edit Area Type')}
      backHref="/backend/resources/area-types"
      versionHistory={mode === 'edit'
        ? { resourceKind: 'resources.resourceAreaType', resourceId: initialValues.id ?? '' }
        : undefined}
      cancelHref="/backend/resources/area-types"
      submitLabel={t('resources.areaTypes.form.save', 'Save')}
      fields={fields}
      groups={groups}
      entityId={E.resources.resources_resource_area_type}
      initialValues={initialValues}
      optimisticLockUpdatedAt={mode === 'edit' ? initialValues.updatedAt : undefined}
      isLoading={isLoading}
      onSubmit={onSubmit}
      onDelete={mode === 'edit' ? onDelete : undefined}
      deleteVisible={typeof deleteVisible === 'boolean' ? deleteVisible : mode === 'edit'}
    />
  )
}
