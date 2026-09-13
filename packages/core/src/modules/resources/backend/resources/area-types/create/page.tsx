"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { buildAreaTypePayload, AreaTypeCrudForm, type AreaTypeFormValues } from '@open-mercato/core/modules/resources/components/AreaTypeCrudForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function ResourcesAreaTypeCreatePage() {
  const t = useT()
  const router = useRouter()

  const handleSubmit = React.useCallback(async (values: AreaTypeFormValues) => {
    const payload = buildAreaTypePayload(values)
    await createCrud('resources/area-types', payload, {
      errorMessage: t('resources.areaTypes.errors.save', 'Failed to save area type.'),
    })
    flash(t('resources.areaTypes.messages.saved', 'Area type saved.'), 'success')
    router.push('/backend/resources/area-types')
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <AreaTypeCrudForm
          mode="create"
          initialValues={{ name: '', description: '', isActive: true, appearance: { icon: null, color: null } }}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
