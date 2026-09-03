"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { buildResourceAreaPayload, ResourceAreaCrudForm, type ResourceAreaFormValues } from '@open-mercato/core/modules/resources/components/ResourceAreaCrudForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function ResourcesResourceAreaCreatePage() {
  const t = useT()
  const router = useRouter()

  const handleSubmit = React.useCallback(async (values: ResourceAreaFormValues) => {
    const payload = buildResourceAreaPayload(values)
    await createCrud('resources/areas', payload, {
      errorMessage: t('resources.resourceAreas.errors.save', 'Failed to save resource area.'),
    })
    flash(t('resources.resourceAreas.messages.saved', 'Resource area saved.'), 'success')
    router.push('/backend/resources/areas')
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <ResourceAreaCrudForm
          mode="create"
          initialValues={{ name: '', description: '', appearance: { icon: null, color: null }, areaType: 'other', parentAreaId: null, sortOrder: 0, isActive: true }}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
