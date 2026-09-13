"use client"
import { E } from '#generated/entities.ids.generated'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function CreateTenantPage() {
  const t = useT()
  const fields: CrudField[] = React.useMemo(() => [
    {
      id: 'name',
      label: t('directory.tenants.form.fields.name', 'Name'),
      type: 'text',
      required: true,
      placeholder: t('directory.tenants.form.placeholders.name', 'Tenant name'),
    },
    { id: 'isActive', label: t('directory.tenants.form.fields.active', 'Active'), type: 'checkbox' },
  ], [t])

  const groups: CrudFormGroup[] = React.useMemo(() => [
    { id: 'details', title: t('directory.tenants.form.groups.details', 'Details'), column: 1, fields: ['name', 'isActive'] },
    { id: 'custom', title: t('directory.tenants.form.groups.custom', 'Custom Data'), column: 2, kind: 'customFields' },
  ], [t])

  return (
    <Page>
      <PageBody>
        <CrudForm<{
          name: string
          isActive: boolean
        } & Record<string, unknown>>
          title={t('directory.tenants.form.title.create', 'Create Tenant')}
          backHref="/backend/directory/tenants"
          fields={fields}
          groups={groups}
          entityId={E.directory.tenant}
          initialValues={{ name: '', isActive: true }}
          submitLabel={t('directory.tenants.form.actions.create', 'Create')}
          cancelHref="/backend/directory/tenants"
          successRedirect={`/backend/directory/tenants?flash=${encodeURIComponent(t('directory.tenants.flash.created', 'Tenant created'))}&type=success`}
          onSubmit={async (values) => {
            const customFields = collectCustomFieldValues(values)
            const payload: {
              name: string
              isActive: boolean
              customFields?: Record<string, unknown>
            } = {
              name: values.name,
              isActive: values.isActive !== false,
            }
            if (Object.keys(customFields).length > 0) {
              payload.customFields = customFields
            }
            await createCrud('directory/tenants', payload)
          }}
        />
      </PageBody>
    </Page>
  )
}
