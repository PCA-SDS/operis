'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type TemplateForm = {
  templateKey: string
  name: string
  description: string
  category: string
  status: 'draft' | 'published' | 'archived'
  subject: string
  preheader: string
  html: string
  variables: string
  fields: string
  defaultValues: string
  rules: string
  workflowKey: string
}

const starterTemplates: Record<string, Partial<TemplateForm>> = {
  quarterly_info: {
    templateKey: 'accounting.quarterly-info',
    name: 'Quarterly info request',
    subject: 'Quarterly accounting information request',
    preheader: 'Please send documents for the current quarter.',
    variables: 'clientName, quarterLabel, deadlineDate, uploadFolderUrl',
    fields: 'clientName, quarterLabel, deadlineDate, uploadFolderUrl',
    defaultValues: JSON.stringify({ uploadFolderUrl: 'https://example.com/client-upload-folder' }, null, 2),
    rules: JSON.stringify({ workflow: 'quarterly-info', requiresVatActivityCheck: false }, null, 2),
    html: '<p>Hello {{clientName}},</p><p>Please send accounting documents for {{quarterLabel}} by {{deadlineDate}}.</p><p>Upload folder: <a href="{{uploadFolderUrl}}">{{uploadFolderUrl}}</a></p>',
    workflowKey: 'quarterly-info',
  },
  quarterly_tax_activity: {
    templateKey: 'accounting.quarterly-tax-with-activity',
    name: 'Quarterly tax — with activity',
    subject: 'Quarterly tax filing — activity detected',
    variables: 'clientName, quarterLabel, salesSheetUrl, purchaseSheetUrl, deadlineDate',
    fields: 'clientName, quarterLabel, salesSheetUrl, purchaseSheetUrl, deadlineDate',
    defaultValues: JSON.stringify({ salesSheetUrl: 'https://example.com/sales-sheet', purchaseSheetUrl: 'https://example.com/purchase-sheet' }, null, 2),
    rules: JSON.stringify({ workflow: 'quarterly-tax', hasActivity: true }, null, 2),
    html: '<p>Hello {{clientName}},</p><p>We detected activity for {{quarterLabel}}. Please review sales and purchase placeholders before {{deadlineDate}}.</p><ul><li>Sales: {{salesSheetUrl}}</li><li>Purchases: {{purchaseSheetUrl}}</li></ul>',
    workflowKey: 'quarterly-tax',
  },
  quarterly_tax_no_activity: {
    templateKey: 'accounting.quarterly-tax-no-activity',
    name: 'Quarterly tax — no activity',
    subject: 'Quarterly tax filing — no activity confirmation',
    variables: 'clientName, quarterLabel, confirmationDeadline',
    fields: 'clientName, quarterLabel, confirmationDeadline',
    defaultValues: JSON.stringify({}, null, 2),
    rules: JSON.stringify({ workflow: 'quarterly-tax', hasActivity: false }, null, 2),
    html: '<p>Hello {{clientName}},</p><p>Please confirm there was no taxable activity for {{quarterLabel}} by {{confirmationDeadline}}.</p>',
    workflowKey: 'quarterly-tax',
  },
  q3_cit: {
    templateKey: 'accounting.q3-cit',
    name: 'Q3 CIT reminder',
    subject: 'Q3 CIT preparation',
    variables: 'clientName, fiscalYear, citSheetUrl, deadlineDate',
    fields: 'clientName, fiscalYear, citSheetUrl, deadlineDate',
    defaultValues: JSON.stringify({ citSheetUrl: 'https://example.com/cit-working-paper' }, null, 2),
    rules: JSON.stringify({ workflow: 'cit', quarter: 'Q3' }, null, 2),
    html: '<p>Hello {{clientName}},</p><p>Please review Q3 CIT preparation for {{fiscalYear}} at {{citSheetUrl}} by {{deadlineDate}}.</p>',
    workflowKey: 'cit-q3',
  },
  q4_cit: {
    templateKey: 'accounting.q4-cit',
    name: 'Q4 CIT finalization',
    subject: 'Q4 CIT finalization',
    variables: 'clientName, fiscalYear, citSheetUrl, finalDeadline',
    fields: 'clientName, fiscalYear, citSheetUrl, finalDeadline',
    defaultValues: JSON.stringify({ citSheetUrl: 'https://example.com/cit-final-working-paper' }, null, 2),
    rules: JSON.stringify({ workflow: 'cit', quarter: 'Q4' }, null, 2),
    html: '<p>Hello {{clientName}},</p><p>Please finalize CIT for {{fiscalYear}} using {{citSheetUrl}} before {{finalDeadline}}.</p>',
    workflowKey: 'cit-q4',
  },
}

const initialForm: TemplateForm = {
  templateKey: '',
  name: '',
  description: '',
  category: 'accounting',
  status: 'draft',
  subject: '',
  preheader: '',
  html: '<p>Hello {{clientName}},</p><p>Write your email body here.</p>',
  variables: 'clientName',
  fields: 'clientName',
  defaultValues: '{}',
  rules: '{}',
  workflowKey: '',
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

function buildPayload(form: TemplateForm) {
  const variables = splitCsv(form.variables)
  const fields = splitCsv(form.fields)
  const defaultValues = parseJsonObject(form.defaultValues, 'Default values')
  const rules = parseJsonObject(form.rules, 'Rules')
  const html = form.html.trim()

  return {
    template_key: form.templateKey.trim(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    category: form.category.trim() || 'accounting',
    status: form.status,
    subject: form.subject.trim(),
    preheader: form.preheader.trim() || null,
    variables,
    blocks: [
      {
        id: 'body-html',
        type: 'rich-text-html',
        label: 'Body',
        props: { html },
        children: [],
      },
    ],
    design: {
      version: 1,
      source: 'operis-email-template-builder',
      body: { format: 'html', html },
    },
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

export default function CreateEmailTemplatePage() {
  const router = useRouter()
  const [form, setForm] = React.useState<TemplateForm>(initialForm)
  const [error, setError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)

  const setField = <K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSaving(true)
    try {
      const payload = buildPayload(form)
      const response = await apiCall<{ id?: string }>('/api/email/templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
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

  let previewBlocks = 'Fill required fields to preview the visual-builder block.'
  try {
    previewBlocks = JSON.stringify(buildPayload({ ...form, templateKey: form.templateKey || 'preview.template', name: form.name || 'Preview', subject: form.subject || 'Preview subject' }).blocks, null, 2)
  } catch {
    previewBlocks = 'Fix JSON defaults/rules to preview the visual-builder block.'
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Create Email Template</h1>
            <p className="mt-1 text-sm text-muted-foreground">Tenant-owned templates with PCA accounting defaults, rules, variables, and visual-builder blocks.</p>
          </div>
          <Button variant="secondary" asChild><Link href="/backend/email/templates">Back</Link></Button>
        </div>
        {error ? <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
        <form className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]" onSubmit={submit}>
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <label className="block text-sm font-medium">PCA starter</label>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              defaultValue=""
              onChange={(event) => {
                const starter = starterTemplates[event.target.value]
                if (starter) setForm((current) => ({ ...current, ...starter }))
              }}
            >
              <option value="">Start blank</option>
              <option value="quarterly_info">Quarterly info request</option>
              <option value="quarterly_tax_activity">Quarterly tax — with activity</option>
              <option value="quarterly_tax_no_activity">Quarterly tax — no activity</option>
              <option value="q3_cit">Q3 CIT reminder</option>
              <option value="q4_cit">Q4 CIT finalization</option>
            </select>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium">Template key<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.templateKey} onChange={(event) => setField('templateKey', event.target.value)} required /></label>
              <label className="block text-sm font-medium">Name<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.name} onChange={(event) => setField('name', event.target.value)} required /></label>
              <label className="block text-sm font-medium">Category<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.category} onChange={(event) => setField('category', event.target.value)} required /></label>
              <label className="block text-sm font-medium">Status<select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.status} onChange={(event) => setField('status', event.target.value as TemplateForm['status'])}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
            </div>
            <label className="block text-sm font-medium">Description<textarea className="mt-1 min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.description} onChange={(event) => setField('description', event.target.value)} /></label>
            <label className="block text-sm font-medium">Subject<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.subject} onChange={(event) => setField('subject', event.target.value)} required /></label>
            <label className="block text-sm font-medium">Preheader<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.preheader} onChange={(event) => setField('preheader', event.target.value)} /></label>
            <label className="block text-sm font-medium">HTML body<textarea className="mt-1 min-h-64 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm" value={form.html} onChange={(event) => setField('html', event.target.value)} required /></label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium">Variables<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.variables} onChange={(event) => setField('variables', event.target.value)} placeholder="clientName, deadlineDate" /></label>
              <label className="block text-sm font-medium">Accounting fields<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.fields} onChange={(event) => setField('fields', event.target.value)} placeholder="clientName, deadlineDate" /></label>
            </div>
            <label className="block text-sm font-medium">Workflow key<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.workflowKey} onChange={(event) => setField('workflowKey', event.target.value)} /></label>
            <label className="block text-sm font-medium">Default values JSON<textarea className="mt-1 min-h-32 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm" value={form.defaultValues} onChange={(event) => setField('defaultValues', event.target.value)} /></label>
            <label className="block text-sm font-medium">Rules JSON<textarea className="mt-1 min-h-32 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm" value={form.rules} onChange={(event) => setField('rules', event.target.value)} /></label>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" asChild><Link href="/backend/email/templates">Cancel</Link></Button><Button type="submit" disabled={isSaving}>{isSaving ? 'Creating…' : 'Create Template'}</Button></div>
          </div>
          <aside className="space-y-4 rounded-lg border bg-card p-4">
            <div><h2 className="font-semibold">Preview</h2><p className="text-sm text-muted-foreground">Variables use double braces, e.g. <code>{'{{clientName}}'}</code>.</p></div>
            <div className="rounded-md border bg-background p-3"><div className="text-xs uppercase text-muted-foreground">Subject</div><div className="mt-1 font-medium">{form.subject || 'Untitled subject'}</div>{form.preheader ? <div className="mt-1 text-sm text-muted-foreground">{form.preheader}</div> : null}</div>
            <div className="rounded-md border bg-background p-3"><div className="text-xs uppercase text-muted-foreground">Visual builder block</div><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs">{previewBlocks}</pre></div>
          </aside>
        </form>
      </PageBody>
    </Page>
  )
}
