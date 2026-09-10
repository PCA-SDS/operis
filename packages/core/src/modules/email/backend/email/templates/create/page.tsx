'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  TemplateBuilderForm,
  type TemplateBuilderFormValue,
  blocksToHtml,
  buildTemplateBlocks,
  createStaticBlock,
  customTemplateValues,
  customTemplateVariables,
  parseJsonObject,
  splitCsv,
} from '../_components/TemplateBuilderForm'

const initialForm: TemplateBuilderFormValue = {
  templateKey: '',
  name: '',
  description: '',
  category: 'accounting',
  status: 'draft',
  subject: '',
  preheader: '',
  variables: '',
  fields: '',
  defaultValues: '{}',
  variableTypes: '{}',
  rules: '{}',
  workflowKey: '',
  sortOrder: '0',
  isActive: true,
  blocks: [],
}

function createInitialForm(bodyText: string): TemplateBuilderFormValue {
  return {
    ...initialForm,
    blocks: [createStaticBlock('initial-body', 'rich-text-html', `<p>Hello {{companyName}},</p><p>${bodyText}</p>`)],
  }
}

function buildPayload(form: TemplateBuilderFormValue) {
  const variables = customTemplateVariables(form.variables)
  const fields = splitCsv(form.fields)
  const defaultValues = parseJsonObject(form.defaultValues, 'Default values')
  const variableTypes = parseJsonObject(form.variableTypes, 'Variable types')
  const rules = parseJsonObject(form.rules, 'Rules')
  const html = blocksToHtml(form.blocks)
  const sortOrder = Number.parseInt(form.sortOrder, 10)

  return {
    template_key: form.templateKey.trim(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    category: form.category.trim() || 'accounting',
    status: form.status,
    subject: form.subject.trim(),
    preheader: form.preheader.trim() || null,
    variables,
    blocks: buildTemplateBlocks(form.blocks),
    design: {
      version: 1,
      source: 'operis-email-template-builder',
      body: { format: 'blocks+html', html },
    },
    accounting_metadata: {
      workflowKey: form.workflowKey.trim() || undefined,
      ruleKeys: Object.entries(rules).map(([key, value]) => `${key}:${String(value)}`),
      migratedFrom: null,
      sourceTemplateId: null,
      fields,
      defaultValues: customTemplateValues(defaultValues),
      variableTypes,
      rules,
      sortOrder: Number.isFinite(sortOrder) && sortOrder >= 0 ? sortOrder : 0,
      isActive: form.isActive && form.status !== 'archived',
    },
  }
}

export default function CreateEmailTemplatePage() {
  const t = useT()
  const router = useRouter()
  const [form, setForm] = React.useState<TemplateBuilderFormValue>(() => createInitialForm(t('email.templates.form.initialBody', 'Write your email body here.')))
  const [error, setError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSaving(true)
    try {
      const response = await apiCall<{ id?: string }>('/api/email/templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPayload(form)),
      })
      if (!response.ok) {
        const body = response.result as { error?: string; message?: string } | undefined
        throw new Error(body?.error ?? body?.message ?? t('email.templates.errors.create', 'Failed to create email template'))
      }
      router.push('/backend/email/templates')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('email.templates.errors.create', 'Failed to create email template'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('email.templates.create.title', 'Create Email Template')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('email.templates.create.description', 'Tenant-owned templates with workflow rules, typed variables, live preview, and visual-builder blocks.')}</p>
          </div>
          <Button variant="secondary" asChild><Link href="/backend/email/templates">{t('email.common.back', 'Back')}</Link></Button>
        </div>
        <TemplateBuilderForm mode="create" value={form} error={error} isSaving={isSaving} onChange={setForm} onSubmit={submit} />
      </PageBody>
    </Page>
  )
}
