"use client"

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { buildRecordInjectionContext, useSetCurrentRecordInjectionContext } from '@open-mercato/ui/backend/injection/recordContext'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { buildResourceAreaPayload, ResourceAreaCrudForm, type ResourceAreaFormValues } from '@open-mercato/core/modules/resources/components/ResourceAreaCrudForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'

const logger = createLogger('resources').child({ component: 'resource-areas-edit-page' })

type ResourceAreasResponse = {
  items?: Array<Record<string, unknown>>
}

export default function ResourcesResourceAreaEditPage({ params }: { params?: { id?: string } }) {
  const resourceAreaId = params?.id ?? ''
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const [initialValues, setInitialValues] = React.useState<ResourceAreaFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  React.useEffect(() => {
    if (!resourceAreaId) return
    let cancelled = false
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const payload = await readApiResultOrThrow<ResourceAreasResponse>(
          `/api/resources/areas?ids=${encodeURIComponent(resourceAreaId)}&page=1&pageSize=1`,
          { signal: controller.signal },
          { errorMessage: t('resources.resourceAreas.errors.load', 'Failed to load resource areas.') },
        )
        const item = Array.isArray(payload.items) ? payload.items[0] : null
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        if (!cancelled) {
          setInitialValues({
            id: typeof item.id === 'string' ? item.id : resourceAreaId,
            name: typeof item.name === 'string' ? item.name : '',
            description: typeof item.description === 'string' ? item.description : '',
            areaTypeId: typeof item.area_type_id === 'string' ? item.area_type_id : null,
            parentAreaId: typeof item.parent_area_id === 'string' ? item.parent_area_id : null,
            isActive: typeof item.is_active === 'boolean' ? item.is_active : true,
            appearance: {
              icon: typeof item.appearance_icon === 'string'
                ? item.appearance_icon
                : typeof item.appearanceIcon === 'string'
                  ? item.appearanceIcon
                  : null,
              color: typeof item.appearance_color === 'string'
                ? item.appearance_color
                : typeof item.appearanceColor === 'string'
                  ? item.appearanceColor
                : null,
            },
            updatedAt: typeof item.updatedAt === 'string'
              ? item.updatedAt
              : typeof item.updated_at === 'string'
                ? item.updated_at
                : null,
          })
        }
      } catch (err) {
        logger.error('Failed to load resource areas', { err })
        if (!cancelled) setError(t('resources.resourceAreas.errors.load', 'Failed to load resource areas.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true; controller.abort() }
  }, [resourceAreaId, t])

  const handleSubmit = React.useCallback(async (values: ResourceAreaFormValues) => {
    if (!resourceAreaId) return
    const payload = buildResourceAreaPayload(values, { id: resourceAreaId })
    const headers = buildOptimisticLockHeader(initialValues?.updatedAt ?? null)
    await withScopedApiRequestHeaders(headers, () =>
      updateCrud('resources/areas', payload, {
        errorMessage: t('resources.resourceAreas.errors.save', 'Failed to save resource area.'),
      }),
    )
    flash(t('resources.resourceAreas.messages.saved', 'Resource area saved.'), 'success')
    router.push('/backend/resources/areas')
  }, [resourceAreaId, router, t, initialValues?.updatedAt])

  const handleDelete = React.useCallback(async () => {
    if (!resourceAreaId) return
    const headers = buildOptimisticLockHeader(initialValues?.updatedAt ?? null)
    try {
      await withScopedApiRequestHeaders(headers, () =>
        deleteCrud('resources/areas', resourceAreaId, {
          errorMessage: t('resources.resourceAreas.errors.delete', 'Failed to delete resource area.'),
        }),
      )
      flash(t('resources.resourceAreas.messages.deleted', 'Resource area deleted.'), 'success')
      router.push('/backend/resources/areas')
    } catch (error: any) {
      if (error?.status === 400) {
        flash(t('resources.resourceAreas.errors.deleteAssigned', 'Cannot delete area with children or assigned resources.'), 'error')
      }
    }
  }, [resourceAreaId, router, t, initialValues?.updatedAt])

  useSetCurrentRecordInjectionContext(
    buildRecordInjectionContext({
      resourceKind: 'resources.resourceArea',
      resourceId: resourceAreaId || null,
      updatedAt: initialValues?.updatedAt ?? null,
      data: initialValues as Record<string, unknown> | null,
      path: pathname,
    }),
  )

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('resources.resourceAreas.errors.notFound', 'Resource area not found.')}
            backHref="/backend/resources/areas"
            backLabel={t('resources.resourceAreas.actions.backToList', 'Back to resource areas')}
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        {error ? (
          <ErrorMessage label={error} />
        ) : null}
        <ResourceAreaCrudForm
          mode="edit"
          initialValues={initialValues ?? { id: resourceAreaId, name: '', description: '', appearance: { icon: null, color: null }, areaTypeId: null, parentAreaId: null, isActive: true }}
          isLoading={loading}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
        />
      </PageBody>
    </Page>
  )
}
