"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createRuleSetFormSchema, type RuleSetFormValues } from '../../../components/formConfig'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'


export default function CreateRuleSetPage() {
  const router = useRouter()
  const t = useT()
  const ruleSetFormSchema = React.useMemo(() => createRuleSetFormSchema(t), [t])

  const handleSubmit = async (values: RuleSetFormValues) => {
    // Note: tenantId and organizationId are injected by the API from auth token
    const payload = {
      setId: values.setId,
      setName: values.setName,
      description: values.description || null,
      enabled: values.enabled ?? true,
    }

    const response = await apiFetch('/api/business_rules/sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      // A 502 HTML page or an empty body would make `.json()` throw a
      // SyntaxError that replaces the real failure with a parse error.
      const error = await readJsonSafe<{ error?: string; message?: string }>(response, {})
      throw new Error(error?.error || error?.message || t('business_rules.sets.errors.createFailed'))
    }

    const result = await readJsonSafe<{ id?: string }>(response, {})
    router.push(`/backend/sets/${result?.id ?? ''}`)
    router.refresh()
  }

  const fields: CrudField[] = React.useMemo(() => [
    {
      id: 'setId',
      label: t('business_rules.sets.form.setId'),
      type: 'text',
      required: true,
      placeholder: t('business_rules.sets.form.placeholders.setId'),
      description: t('business_rules.sets.form.descriptions.setId'),
    },
    {
      id: 'setName',
      label: t('business_rules.sets.form.setName'),
      type: 'text',
      required: true,
      placeholder: t('business_rules.sets.form.placeholders.setName'),
    },
    {
      id: 'description',
      label: t('business_rules.sets.form.description'),
      type: 'textarea',
      placeholder: t('business_rules.sets.form.placeholders.description'),
    },
    {
      id: 'enabled',
      label: t('business_rules.sets.form.enabled'),
      type: 'checkbox',
      description: t('business_rules.sets.form.descriptions.enabled'),
    },
  ], [t])

  const initialValues: Partial<RuleSetFormValues> = {
    enabled: true,
  }

  const formGroups = React.useMemo(() => [
    {
      id: 'details',
      column: 1 as const,
      fields: ['setId', 'setName', 'description', 'enabled'],
    },
  ], [])

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('business_rules.sets.create.title')}
          backHref="/backend/sets"
          schema={ruleSetFormSchema}
          fields={fields}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          cancelHref="/backend/sets"
          submitLabel={t('business_rules.sets.form.create')}
          groups={formGroups}
        />
      </PageBody>
    </Page>
  )
}
