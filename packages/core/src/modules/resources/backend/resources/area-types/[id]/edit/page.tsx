"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { extractCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields-client'
import { buildAreaTypePayload, AreaTypeCrudForm, type AreaTypeFormValues } from '@open-mercato/core/modules/resources/components/AreaTypeCrudForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'

type AreaTypesResponse = {
  items?: Array<Record<string, unknown>>
}

export default function ResourcesAreaTypeEditPage({ params }: { params?: { id?: string } }) {
  const areaTypeId = params?.id ?? ''
  const t = useT()
  const router = useRouter()
  const [initialValues, setInitialValues] = React.useState<AreaTypeFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const [areaCount, setAreaCount] = React.useState(0)

  React.useEffect(() => {
    if (!areaTypeId) return
    let cancelled = false
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const payload = await readApiResultOrThrow<AreaTypesResponse>(
          `/api/resources/area-types?ids=${encodeURIComponent(areaTypeId)}&page=1&pageSize=1&withAreaCounts=true`,
          { signal: controller.signal },
        )
        const item = Array.isArray(payload.items) ? payload.items[0] : null
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        if (!cancelled) {
          const customValues = extractCustomFieldValues(item)
          setInitialValues({
            id: typeof item.id === 'string' ? item.id : areaTypeId,
            name: typeof item.name === 'string' ? item.name : '',
            description: typeof item.description === 'string' ? item.description : '',
            isActive: item.isActive !== false,
            appearance: {
              icon: typeof item.appearanceIcon === 'string'
                ? item.appearanceIcon
                : typeof item.appearance_icon === 'string'
                  ? item.appearance_icon
                  : null,
              color: typeof item.appearanceColor === 'string'
                ? item.appearanceColor
                : typeof item.appearance_color === 'string'
                  ? item.appearance_color
                  : null,
            },
            updatedAt: typeof item.updatedAt === 'string'
              ? item.updatedAt
              : typeof item.updated_at === 'string'
                ? item.updated_at
                : null,
            ...customValues,
          })
          setAreaCount(
            typeof item.areaCount === 'number'
              ? item.areaCount
              : typeof item.area_count === 'number'
                ? item.area_count
                : 0,
          )
        }
      } catch {
        if (!cancelled) setError(t('resources.areaTypes.errors.load', 'Failed to load area types.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true; controller.abort() }
  }, [areaTypeId, t])

  const handleSubmit = React.useCallback(async (values: AreaTypeFormValues) => {
    if (!areaTypeId) return
    const payload = buildAreaTypePayload(values, { id: areaTypeId })
    const headers = buildOptimisticLockHeader(initialValues?.updatedAt ?? null)
    await withScopedApiRequestHeaders(headers, () =>
      updateCrud('resources/area-types', payload, {
        errorMessage: t('resources.areaTypes.errors.save', 'Failed to save area type.'),
      }),
    )
    flash(t('resources.areaTypes.messages.saved', 'Area type saved.'), 'success')
    router.push('/backend/resources/area-types')
  }, [areaTypeId, router, t, initialValues?.updatedAt])

  const handleDelete = React.useCallback(async () => {
    if (!areaTypeId) return
    const headers = buildOptimisticLockHeader(initialValues?.updatedAt ?? null)
    await withScopedApiRequestHeaders(headers, () =>
      deleteCrud('resources/area-types', areaTypeId, {
        errorMessage: t('resources.areaTypes.errors.delete', 'Failed to delete area type.'),
      }),
    )
    flash(t('resources.areaTypes.messages.deleted', 'Area type deleted.'), 'success')
    router.push('/backend/resources/area-types')
  }, [areaTypeId, router, t, initialValues?.updatedAt])

  if (loading) return null
  if (error) return <Page><PageBody><ErrorMessage label={error} /></PageBody></Page>
  if (isNotFound) return (
    <Page>
      <PageBody>
        <RecordNotFoundState
          label={t('resources.areaTypes.errors.notFound', 'Area type not found.')}
          backHref="/backend/resources/area-types"
        />
      </PageBody>
    </Page>
  )
  if (!initialValues) return null

  return (
    <Page>
      <PageBody>
        <AreaTypeCrudForm
          mode="edit"
          initialValues={initialValues}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          deleteVisible={areaCount === 0}
        />
      </PageBody>
    </Page>
  )
}
