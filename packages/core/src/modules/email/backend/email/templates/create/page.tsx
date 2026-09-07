'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  TemplateBuilderForm,
  type TemplateBuilderFormValue,
  blocksToHtml,
  buildTemplateBlocks,
  createBlock,
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
  rules: '{}',
  workflowKey: '',
  sortOrder: '0',
  isActive: true,
  blocks: [createBlock('paragraph', 'Hello {{companyName}},\n\nWrite your email body here.')],
}

function buildPayload(form: TemplateBuilderFormValue) {
  const variables = customTemplateVariables(form.variables)
  const fields = splitCsv(form.fields)
  const defaultValues = parseJsonObject(form.defaultValues, 'Default values')
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
      migratedFrom: 'pca-accounting',
      sourceTemplateId: form.templateKey.trim() || null,
      fields,
      defaultValues: customTemplateValues(defaultValues),
      rules,
      sortOrder: Number.isFinite(sortOrder) && sortOrder >= 0 ? sortOrder : 0,
      isActive: form.isActive && form.status !== 'archived',
    },
  }
}

export default function CreateEmailTemplatePage() {
  const router = useRouter()
  const [form, setForm] = React.useState<TemplateBuilderFormValue>(initialForm)
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
        throw new Error(body?.error ?? body?.message ?? 'Failed to create email template')
      }
      router.push('/backend/email/templates')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create email template')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Create Email Template</h1>
            <p className="mt-1 text-sm text-muted-foreground">Tenant-owned templates with PCA accounting defaults, rules, variables, live preview, and visual-builder blocks.</p>
          </div>
          <Button variant="secondary" asChild><Link href="/backend/email/templates">Back</Link></Button>
        </div>
        <TemplateBuilderForm mode="create" value={form} error={error} isSaving={isSaving} onChange={setForm} onSubmit={submit} />
      </PageBody>
    </Page>
  )
}
