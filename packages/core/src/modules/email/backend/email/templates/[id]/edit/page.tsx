'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import {
  TemplateBuilderForm,
  type TemplateBlockFormValue,
  type TemplateBuilderFormValue,
  blocksToHtml,
  buildTemplateBlocks,
  createBlock,
  parseJsonObject,
  splitCsv,
} from '../../_components/TemplateBuilderForm'

type TemplateStatus = 'draft' | 'published' | 'archived'

type EmailTemplateRecord = {
  id: string
  template_key: string
  name: string
  description: string | null
  category: string
  status: TemplateStatus
  subject: string
  preheader: string | null
  design: unknown
  blocks: unknown
  variables: unknown
  accounting_metadata: {
    workflowKey?: string
    fields?: string[]
    defaultValues?: Record<string, string>
    rules?: Record<string, unknown>
    sortOrder?: number
    isActive?: boolean
  } | null
  updatedAt: string
}

type EmailTemplateListResponse = { items?: EmailTemplateRecord[] }

type EditTemplateForm = TemplateBuilderFormValue & { updatedAt: string }

const emptyForm: EditTemplateForm = {
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
  blocks: [],
  updatedAt: '',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function blocksFromRecord(blocks: unknown, design: unknown): TemplateBlockFormValue[] {
  if (Array.isArray(blocks) && blocks.length > 0) {
    return blocks.map((item, index) => {
      const record = isRecord(item) ? item : {}
      const props = isRecord(record.props) ? record.props : {}
      const type = typeof record.type === 'string' ? record.type : 'paragraph'
      const safeType: TemplateBlockFormValue['type'] = type === 'heading' || type === 'button' || type === 'divider' || type === 'rich-text-html' ? type : 'paragraph'
      return {
        id: typeof record.id === 'string' ? record.id : `block-${index + 1}`,
        type: safeType,
        label: typeof record.label === 'string' ? record.label : safeType,
        content: typeof props.html === 'string' ? props.html : typeof props.text === 'string' ? props.text : '',
        url: typeof props.href === 'string' ? props.href : '',
      }
    })
  }
  if (isRecord(design) && isRecord(design.body) && typeof design.body.html === 'string') {
    return [createBlock('rich-text-html', design.body.html)]
  }
  return [createBlock('paragraph', '')]
}

function toForm(record: EmailTemplateRecord): EditTemplateForm {
  const metadata = record.accounting_metadata ?? {}
  const fields = Array.isArray(metadata.fields) ? metadata.fields : []
  const defaultValues = metadata.defaultValues && typeof metadata.defaultValues === 'object' ? metadata.defaultValues : {}
  const rules = metadata.rules && typeof metadata.rules === 'object' && !Array.isArray(metadata.rules) ? metadata.rules : {}
  const variables = Array.isArray(record.variables) ? record.variables.filter((value): value is string => typeof value === 'string') : []

  return {
    templateKey: record.template_key,
    name: record.name,
    description: record.description ?? '',
    category: record.category,
    status: record.status,
    subject: record.subject,
    preheader: record.preheader ?? '',
    variables: variables.join(', '),
    fields: fields.join(', '),
    defaultValues: JSON.stringify(defaultValues, null, 2),
    rules: JSON.stringify(rules, null, 2),
    workflowKey: metadata.workflowKey ?? '',
    sortOrder: String(typeof metadata.sortOrder === 'number' ? metadata.sortOrder : 0),
    isActive: metadata.isActive !== false && record.status !== 'archived',
    blocks: blocksFromRecord(record.blocks, record.design),
    updatedAt: record.updatedAt,
  }
}

function buildPayload(form: EditTemplateForm, id: string) {
  const variables = splitCsv(form.variables)
  const fields = splitCsv(form.fields)
  const defaultValues = parseJsonObject(form.defaultValues, 'Default values')
  const rules = parseJsonObject(form.rules, 'Rules')
  const html = blocksToHtml(form.blocks)
  const sortOrder = Number.parseInt(form.sortOrder, 10)

  return {
    id,
    expected_updated_at: form.updatedAt,
    template_key: form.templateKey.trim(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    category: form.category.trim() || 'accounting',
    status: form.status,
    subject: form.subject.trim(),
    preheader: form.preheader.trim() || null,
    variables,
    blocks: buildTemplateBlocks(form.blocks),
    design: { version: 1, source: 'operis-email-template-builder', body: { format: 'blocks+html', html } },
    accounting_metadata: {
      workflowKey: form.workflowKey.trim() || undefined,
      ruleKeys: Object.entries(rules).map(([key, value]) => `${key}:${String(value)}`),
      migratedFrom: 'pca-accounting',
      sourceTemplateId: form.templateKey.trim() || null,
      fields,
      defaultValues: Object.fromEntries(Object.entries(defaultValues).map(([key, value]) => [key, String(value)])),
      rules,
      sortOrder: Number.isFinite(sortOrder) && sortOrder >= 0 ? sortOrder : 0,
      isActive: form.isActive && form.status !== 'archived',
    },
  }
}

export default function EditEmailTemplatePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id
  const [form, setForm] = React.useState<EditTemplateForm>(emptyForm)
  const [error, setError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const response = await apiCall<EmailTemplateListResponse>(`/api/email/templates?id=${encodeURIComponent(id)}`, { signal: controller.signal })
      if (cancelled) return
      if (!response.ok) throw new Error('Failed to load email template')
      const record = response.result?.items?.[0]
      if (!record) throw new Error('Email template not found')
      setForm(toForm(record))
      setIsLoading(false)
    }
    void load().catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Failed to load email template')
        setIsLoading(false)
      }
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [id])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSaving(true)
    try {
      const response = await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(form.updatedAt),
        () => apiCall('/api/email/templates', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildPayload(form, id)),
        }),
      )
      if (!response.ok) {
        const body = response.result as { error?: string; message?: string } | undefined
        throw new Error(body?.error ?? body?.message ?? 'Failed to update email template')
      }
      router.push('/backend/email/templates')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update email template')
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteTemplate() {
    if (!window.confirm('Delete this email template?')) return
    setError(null)
    setIsSaving(true)
    try {
      const response = await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(form.updatedAt),
        () => apiCall('/api/email/templates', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, expected_updated_at: form.updatedAt }),
        }),
      )
      if (!response.ok) {
        const body = response.result as { error?: string; message?: string } | undefined
        throw new Error(body?.error ?? body?.message ?? 'Failed to delete email template')
      }
      router.push('/backend/email/templates')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete email template')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Edit Email Template</h1>
            <p className="mt-1 text-sm text-muted-foreground">Update PCA accounting template content, rules, placeholders, preview, and visual-builder blocks.</p>
          </div>
          <Button variant="secondary" asChild><Link href="/backend/email/templates">Back</Link></Button>
        </div>
        {isLoading ? (
          <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">Loading email template…</div>
        ) : (
          <TemplateBuilderForm mode="edit" value={form} error={error} isSaving={isSaving} onChange={(next) => setForm({ ...next, updatedAt: form.updatedAt })} onSubmit={submit} onDelete={deleteTemplate} />
        )}
      </PageBody>
    </Page>
  )
}
