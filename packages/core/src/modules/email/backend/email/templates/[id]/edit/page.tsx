'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'

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
  } | null
  updatedAt: string
}

type EmailTemplateListResponse = { items?: EmailTemplateRecord[] }

type TemplateForm = {
  templateKey: string
  name: string
  description: string
  category: string
  status: TemplateStatus
  subject: string
  preheader: string
  html: string
  variables: string
  fields: string
  defaultValues: string
  rules: string
  workflowKey: string
  updatedAt: string
}

const emptyForm: TemplateForm = {
  templateKey: '',
  name: '',
  description: '',
  category: 'accounting',
  status: 'draft',
  subject: '',
  preheader: '',
  html: '',
  variables: '',
  fields: '',
  defaultValues: '{}',
  rules: '{}',
  workflowKey: '',
  updatedAt: '',
}

function splitCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value || '{}') as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function extractHtml(blocks: unknown, design: unknown): string {
  if (Array.isArray(blocks)) {
    const block = blocks.find((item): item is { props?: { html?: unknown } } => (
      Boolean(item) && typeof item === 'object' && 'props' in item
    ))
    if (typeof block?.props?.html === 'string') return block.props.html
  }
  if (design && typeof design === 'object' && 'body' in design) {
    const body = (design as { body?: { html?: unknown } }).body
    if (typeof body?.html === 'string') return body.html
  }
  return ''
}

function toForm(record: EmailTemplateRecord): TemplateForm {
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
    html: extractHtml(record.blocks, record.design),
    variables: variables.join(', '),
    fields: fields.join(', '),
    defaultValues: JSON.stringify(defaultValues, null, 2),
    rules: JSON.stringify(rules, null, 2),
    workflowKey: metadata.workflowKey ?? '',
    updatedAt: record.updatedAt,
  }
}

function buildPayload(form: TemplateForm, id: string) {
  const variables = splitCsv(form.variables)
  const fields = splitCsv(form.fields)
  const defaultValues = parseJsonObject(form.defaultValues, 'Default values')
  const rules = parseJsonObject(form.rules, 'Rules')
  const html = form.html.trim()

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
    blocks: [{ id: 'body-html', type: 'rich-text-html', label: 'Body', props: { html }, children: [] }],
    design: { version: 1, source: 'operis-email-template-builder', body: { format: 'html', html } },
    accounting_metadata: {
      workflowKey: form.workflowKey.trim() || undefined,
      ruleKeys: Object.entries(rules).map(([key, value]) => `${key}:${String(value)}`),
      migratedFrom: 'pca-accounting',
      sourceTemplateId: form.templateKey.trim() || null,
      fields,
      defaultValues: Object.fromEntries(Object.entries(defaultValues).map(([key, value]) => [key, String(value)])),
      rules,
      sortOrder: 0,
      isActive: form.status !== 'archived',
    },
  }
}

export default function EditEmailTemplatePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id
  const [form, setForm] = React.useState<TemplateForm>(emptyForm)
  const [error, setError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  const setField = <K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

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

  let previewBlocks = 'Template preview is available after the record loads.'
  try {
    previewBlocks = JSON.stringify(buildPayload({ ...form, updatedAt: form.updatedAt || new Date().toISOString() }, id).blocks, null, 2)
  } catch {
    previewBlocks = 'Fix JSON defaults/rules to preview the visual-builder block.'
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Edit Email Template</h1>
            <p className="mt-1 text-sm text-muted-foreground">Update PCA accounting template content, rules, placeholders, and visual-builder blocks.</p>
          </div>
          <Button variant="secondary" asChild><Link href="/backend/email/templates">Back</Link></Button>
        </div>
        {error ? <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
        {isLoading ? (
          <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">Loading email template…</div>
        ) : (
          <form className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]" onSubmit={submit}>
            <div className="space-y-4 rounded-lg border bg-card p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-sm font-medium">Template key<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.templateKey} onChange={(event) => setField('templateKey', event.target.value)} required /></label>
                <label className="block text-sm font-medium">Name<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.name} onChange={(event) => setField('name', event.target.value)} required /></label>
                <label className="block text-sm font-medium">Category<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.category} onChange={(event) => setField('category', event.target.value)} required /></label>
                <label className="block text-sm font-medium">Status<select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.status} onChange={(event) => setField('status', event.target.value as TemplateStatus)}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
              </div>
              <label className="block text-sm font-medium">Description<textarea className="mt-1 min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.description} onChange={(event) => setField('description', event.target.value)} /></label>
              <label className="block text-sm font-medium">Subject<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.subject} onChange={(event) => setField('subject', event.target.value)} required /></label>
              <label className="block text-sm font-medium">Preheader<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.preheader} onChange={(event) => setField('preheader', event.target.value)} /></label>
              <label className="block text-sm font-medium">HTML body<textarea className="mt-1 min-h-64 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm" value={form.html} onChange={(event) => setField('html', event.target.value)} required /></label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-sm font-medium">Variables<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.variables} onChange={(event) => setField('variables', event.target.value)} /></label>
                <label className="block text-sm font-medium">Accounting fields<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.fields} onChange={(event) => setField('fields', event.target.value)} /></label>
              </div>
              <label className="block text-sm font-medium">Workflow key<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.workflowKey} onChange={(event) => setField('workflowKey', event.target.value)} /></label>
              <label className="block text-sm font-medium">Default values JSON<textarea className="mt-1 min-h-32 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm" value={form.defaultValues} onChange={(event) => setField('defaultValues', event.target.value)} /></label>
              <label className="block text-sm font-medium">Rules JSON<textarea className="mt-1 min-h-32 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm" value={form.rules} onChange={(event) => setField('rules', event.target.value)} /></label>
              <div className="flex justify-between gap-2">
                <Button type="button" variant="destructive" disabled={isSaving} onClick={deleteTemplate}>Delete</Button>
                <div className="flex gap-2"><Button type="button" variant="secondary" asChild><Link href="/backend/email/templates">Cancel</Link></Button><Button type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save Template'}</Button></div>
              </div>
            </div>
            <aside className="space-y-4 rounded-lg border bg-card p-4">
              <div><h2 className="font-semibold">Preview</h2><p className="text-sm text-muted-foreground">Variables use double braces, e.g. <code>{'{{clientName}}'}</code>.</p></div>
              <div className="rounded-md border bg-background p-3"><div className="text-xs uppercase text-muted-foreground">Subject</div><div className="mt-1 font-medium">{form.subject || 'Untitled subject'}</div>{form.preheader ? <div className="mt-1 text-sm text-muted-foreground">{form.preheader}</div> : null}</div>
              <div className="rounded-md border bg-background p-3"><div className="text-xs uppercase text-muted-foreground">Visual builder block</div><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs">{previewBlocks}</pre></div>
            </aside>
          </form>
        )}
      </PageBody>
    </Page>
  )
}
