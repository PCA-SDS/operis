'use client'

import * as React from 'react'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'

type TemplateStatus = 'draft' | 'published' | 'archived'
type BlockType = 'heading' | 'paragraph' | 'button' | 'divider' | 'rich-text-html'

export type TemplateBuilderFormValue = {
  templateKey: string
  name: string
  description: string
  category: string
  status: TemplateStatus
  subject: string
  preheader: string
  variables: string
  fields: string
  defaultValues: string
  rules: string
  workflowKey: string
  blocks: TemplateBlockFormValue[]
}

export type TemplateBlockFormValue = {
  id: string
  type: BlockType
  label: string
  content: string
  url: string
}

type TemplateBuilderFormProps = {
  mode: 'create' | 'edit'
  value: TemplateBuilderFormValue
  error: string | null
  isSaving: boolean
  onChange: (value: TemplateBuilderFormValue) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onDelete?: () => void
}

export const starterTemplates: Record<string, Partial<TemplateBuilderFormValue>> = {
  quarterly_info: {
    templateKey: 'accounting.quarterly-info',
    name: 'Quarterly info request',
    subject: 'Quarterly accounting information request',
    preheader: 'Please send documents for the current quarter.',
    variables: 'clientName, quarterLabel, deadlineDate, uploadFolderUrl',
    fields: 'clientName, quarterLabel, deadlineDate, uploadFolderUrl',
    defaultValues: JSON.stringify({
      clientName: 'Acme Corp',
      quarterLabel: 'Q3 2026',
      deadlineDate: '15 Oct 2026',
      uploadFolderUrl: 'https://example.com/client-upload-folder',
    }, null, 2),
    rules: JSON.stringify({ workflow: 'quarterly-info', requiresVatActivityCheck: false }, null, 2),
    workflowKey: 'quarterly-info',
    blocks: [
      createBlock('heading', 'Quarterly information request'),
      createBlock('paragraph', 'Hello {{clientName}},\n\nPlease send accounting documents for {{quarterLabel}} by {{deadlineDate}}.'),
      createBlock('button', 'Open upload folder', 'https://example.com/client-upload-folder'),
    ],
  },
  quarterly_tax_activity: {
    templateKey: 'accounting.quarterly-tax-with-activity',
    name: 'Quarterly tax — with activity',
    subject: 'Quarterly tax filing — activity detected',
    variables: 'clientName, quarterLabel, salesSheetUrl, purchaseSheetUrl, deadlineDate',
    fields: 'clientName, quarterLabel, salesSheetUrl, purchaseSheetUrl, deadlineDate',
    defaultValues: JSON.stringify({
      clientName: 'Acme Corp',
      quarterLabel: 'Q3 2026',
      salesSheetUrl: 'https://example.com/sales-sheet',
      purchaseSheetUrl: 'https://example.com/purchase-sheet',
      deadlineDate: '15 Oct 2026',
    }, null, 2),
    rules: JSON.stringify({ workflow: 'quarterly-tax', hasActivity: true }, null, 2),
    workflowKey: 'quarterly-tax',
    blocks: [
      createBlock('heading', 'Quarterly tax filing'),
      createBlock('paragraph', 'Hello {{clientName}},\n\nWe detected activity for {{quarterLabel}}. Please review the sales and purchase placeholders before {{deadlineDate}}.'),
      createBlock('paragraph', 'Sales sheet: {{salesSheetUrl}}\nPurchase sheet: {{purchaseSheetUrl}}'),
    ],
  },
  quarterly_tax_no_activity: {
    templateKey: 'accounting.quarterly-tax-no-activity',
    name: 'Quarterly tax — no activity',
    subject: 'Quarterly tax filing — no activity confirmation',
    variables: 'clientName, quarterLabel, confirmationDeadline',
    fields: 'clientName, quarterLabel, confirmationDeadline',
    defaultValues: JSON.stringify({ clientName: 'Acme Corp', quarterLabel: 'Q3 2026', confirmationDeadline: '15 Oct 2026' }, null, 2),
    rules: JSON.stringify({ workflow: 'quarterly-tax', hasActivity: false }, null, 2),
    workflowKey: 'quarterly-tax',
    blocks: [
      createBlock('heading', 'No activity confirmation'),
      createBlock('paragraph', 'Hello {{clientName}},\n\nPlease confirm there was no taxable activity for {{quarterLabel}} by {{confirmationDeadline}}.'),
    ],
  },
  q3_cit: {
    templateKey: 'accounting.q3-cit',
    name: 'Q3 CIT reminder',
    subject: 'Q3 CIT preparation',
    variables: 'clientName, fiscalYear, citSheetUrl, deadlineDate',
    fields: 'clientName, fiscalYear, citSheetUrl, deadlineDate',
    defaultValues: JSON.stringify({ clientName: 'Acme Corp', fiscalYear: '2026', citSheetUrl: 'https://example.com/cit-working-paper', deadlineDate: '31 Oct 2026' }, null, 2),
    rules: JSON.stringify({ workflow: 'cit', quarter: 'Q3' }, null, 2),
    workflowKey: 'cit-q3',
    blocks: [createBlock('heading', 'Q3 CIT preparation'), createBlock('paragraph', 'Hello {{clientName}},\n\nPlease review Q3 CIT preparation for {{fiscalYear}} at {{citSheetUrl}} by {{deadlineDate}}.')],
  },
  q4_cit: {
    templateKey: 'accounting.q4-cit',
    name: 'Q4 CIT finalization',
    subject: 'Q4 CIT finalization',
    variables: 'clientName, fiscalYear, citSheetUrl, finalDeadline',
    fields: 'clientName, fiscalYear, citSheetUrl, finalDeadline',
    defaultValues: JSON.stringify({ clientName: 'Acme Corp', fiscalYear: '2026', citSheetUrl: 'https://example.com/cit-final-working-paper', finalDeadline: '31 Mar 2027' }, null, 2),
    rules: JSON.stringify({ workflow: 'cit', quarter: 'Q4' }, null, 2),
    workflowKey: 'cit-q4',
    blocks: [createBlock('heading', 'Q4 CIT finalization'), createBlock('paragraph', 'Hello {{clientName}},\n\nPlease finalize CIT for {{fiscalYear}} using {{citSheetUrl}} before {{finalDeadline}}.')],
  },
}

export function createBlock(type: BlockType, content = '', url = ''): TemplateBlockFormValue {
  return {
    id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    label: type === 'button' ? 'Button' : type === 'heading' ? 'Heading' : type === 'divider' ? 'Divider' : 'Body text',
    content,
    url,
  }
}

export function splitCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

export function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value || '{}') as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

export function buildTemplateBlocks(blocks: TemplateBlockFormValue[]) {
  return blocks.map((block, index) => ({
    id: block.id || `block-${index + 1}`,
    type: block.type,
    label: block.label || block.type,
    props: {
      text: block.type === 'rich-text-html' ? undefined : block.content,
      html: block.type === 'rich-text-html' ? block.content : undefined,
      href: block.type === 'button' ? block.url : undefined,
      order: index,
    },
    children: [],
  }))
}

export function blocksToHtml(blocks: TemplateBlockFormValue[]): string {
  return blocks.map((block) => {
    if (block.type === 'heading') return `<h2>${escapeHtml(block.content)}</h2>`
    if (block.type === 'button') return `<p><a href="${escapeHtml(block.url || '#')}">${escapeHtml(block.content || 'Open link')}</a></p>`
    if (block.type === 'divider') return '<hr />'
    if (block.type === 'rich-text-html') return block.content
    return `<p>${escapeHtml(block.content).replace(/\n/g, '<br />')}</p>`
  }).join('\n')
}

export function renderWithSamples(value: string, samples: Record<string, unknown>): string {
  return value.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key: string) => String(samples[key] ?? `{{${key}}}`))
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function TemplateBuilderForm({ mode, value, error, isSaving, onChange, onSubmit, onDelete }: TemplateBuilderFormProps) {
  const setField = <K extends keyof TemplateBuilderFormValue>(key: K, fieldValue: TemplateBuilderFormValue[K]) => {
    onChange({ ...value, [key]: fieldValue })
  }
  const updateBlock = (index: number, patch: Partial<TemplateBlockFormValue>) => {
    onChange({ ...value, blocks: value.blocks.map((block, blockIndex) => blockIndex === index ? { ...block, ...patch } : block) })
  }
  const moveBlock = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= value.blocks.length) return
    const next = [...value.blocks]
    const [block] = next.splice(index, 1)
    if (!block) return
    next.splice(nextIndex, 0, block)
    onChange({ ...value, blocks: next })
  }

  let sampleValues: Record<string, unknown> = {}
  let previewError: string | null = null
  try {
    sampleValues = parseJsonObject(value.defaultValues, 'Default values')
  } catch (err) {
    previewError = err instanceof Error ? err.message : 'Default values must be valid JSON'
  }
  const previewSubject = renderWithSamples(value.subject || 'Untitled subject', sampleValues)
  const previewHtml = renderWithSamples(blocksToHtml(value.blocks), sampleValues)

  return (
    <>
      {error ? <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
      <form className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,460px)]" onSubmit={onSubmit}>
        <div className="space-y-4 rounded-lg border bg-card p-4">
          {mode === 'create' ? (
            <label className="block text-sm font-medium">PCA starter
              <select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" defaultValue="" onChange={(event) => {
                const starter = starterTemplates[event.target.value]
                if (starter) onChange({ ...value, ...starter, blocks: starter.blocks ?? value.blocks })
              }}>
                <option value="">Start blank</option>
                <option value="quarterly_info">Quarterly info request</option>
                <option value="quarterly_tax_activity">Quarterly tax — with activity</option>
                <option value="quarterly_tax_no_activity">Quarterly tax — no activity</option>
                <option value="q3_cit">Q3 CIT reminder</option>
                <option value="q4_cit">Q4 CIT finalization</option>
              </select>
            </label>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">Template key<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.templateKey} onChange={(event) => setField('templateKey', event.target.value)} required /></label>
            <label className="block text-sm font-medium">Name<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.name} onChange={(event) => setField('name', event.target.value)} required /></label>
            <label className="block text-sm font-medium">Category<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.category} onChange={(event) => setField('category', event.target.value)} required /></label>
            <label className="block text-sm font-medium">Status<select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.status} onChange={(event) => setField('status', event.target.value as TemplateStatus)}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
          </div>
          <label className="block text-sm font-medium">Description<textarea className="mt-1 min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.description} onChange={(event) => setField('description', event.target.value)} /></label>
          <label className="block text-sm font-medium">Subject<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.subject} onChange={(event) => setField('subject', event.target.value)} required /></label>
          <label className="block text-sm font-medium">Preheader<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.preheader} onChange={(event) => setField('preheader', event.target.value)} /></label>

          <section className="space-y-3 rounded-md border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="font-medium">Visual builder blocks</h2><p className="text-xs text-muted-foreground">Editable blocks are stored as template blocks; HTML is generated from them for email rendering.</p></div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => onChange({ ...value, blocks: [...value.blocks, createBlock('heading', 'New heading')] })}>Heading</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => onChange({ ...value, blocks: [...value.blocks, createBlock('paragraph', 'New paragraph')] })}>Text</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => onChange({ ...value, blocks: [...value.blocks, createBlock('button', 'Open link', 'https://example.com/link')] })}>Button</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => onChange({ ...value, blocks: [...value.blocks, createBlock('divider')] })}>Divider</Button>
              </div>
            </div>
            {value.blocks.map((block, index) => (
              <div key={block.id} className="space-y-2 rounded-md border border-border p-3">
                <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)_auto]">
                  <select className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={block.type} onChange={(event) => updateBlock(index, { type: event.target.value as BlockType })}>
                    <option value="heading">Heading</option><option value="paragraph">Paragraph</option><option value="button">Button</option><option value="divider">Divider</option><option value="rich-text-html">Raw HTML</option>
                  </select>
                  <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={block.label} onChange={(event) => updateBlock(index, { label: event.target.value })} placeholder="Block label" />
                  <div className="flex gap-1"><Button type="button" size="sm" variant="ghost" onClick={() => moveBlock(index, -1)}>↑</Button><Button type="button" size="sm" variant="ghost" onClick={() => moveBlock(index, 1)}>↓</Button><Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...value, blocks: value.blocks.filter((_, blockIndex) => blockIndex !== index) })}>Remove</Button></div>
                </div>
                {block.type !== 'divider' ? <textarea className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={block.content} onChange={(event) => updateBlock(index, { content: event.target.value })} placeholder="Use {{variables}} in content" /> : null}
                {block.type === 'button' ? <input className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={block.url} onChange={(event) => updateBlock(index, { url: event.target.value })} placeholder="https://example.com/link" /> : null}
              </div>
            ))}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">Variables<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.variables} onChange={(event) => setField('variables', event.target.value)} placeholder="clientName, deadlineDate" /></label>
            <label className="block text-sm font-medium">Accounting fields<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.fields} onChange={(event) => setField('fields', event.target.value)} placeholder="clientName, deadlineDate" /></label>
          </div>
          <label className="block text-sm font-medium">Workflow key<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.workflowKey} onChange={(event) => setField('workflowKey', event.target.value)} /></label>
          <label className="block text-sm font-medium">Sample/default values JSON<textarea className="mt-1 min-h-32 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm" value={value.defaultValues} onChange={(event) => setField('defaultValues', event.target.value)} /></label>
          <label className="block text-sm font-medium">Rules JSON<textarea className="mt-1 min-h-32 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm" value={value.rules} onChange={(event) => setField('rules', event.target.value)} /></label>
          <div className="flex justify-between gap-2">
            {mode === 'edit' && onDelete ? <Button type="button" variant="destructive" disabled={isSaving} onClick={onDelete}>Delete</Button> : <span />}
            <div className="flex gap-2"><Button type="button" variant="secondary" asChild><Link href="/backend/email/templates">Cancel</Link></Button><Button type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : mode === 'create' ? 'Create Template' : 'Save Template'}</Button></div>
          </div>
        </div>
        <aside className="space-y-4 rounded-lg border bg-card p-4">
          <div><h2 className="font-semibold">Live preview</h2><p className="text-sm text-muted-foreground">Preview uses sample/default values only and does not send email.</p></div>
          {previewError ? <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{previewError}</div> : null}
          <div className="rounded-md border bg-background p-3"><div className="text-xs uppercase text-muted-foreground">Subject</div><div className="mt-1 font-medium">{previewSubject}</div>{value.preheader ? <div className="mt-1 text-sm text-muted-foreground">{renderWithSamples(value.preheader, sampleValues)}</div> : null}</div>
          <div className="rounded-md border bg-background p-3"><div className="text-xs uppercase text-muted-foreground">Email body</div><iframe className="mt-2 h-96 w-full rounded border bg-white" sandbox="" srcDoc={`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;padding:16px">${previewHtml}</body></html>`} title="Email template preview" /></div>
          <div className="rounded-md border bg-background p-3"><div className="text-xs uppercase text-muted-foreground">Stored block payload</div><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(buildTemplateBlocks(value.blocks), null, 2)}</pre></div>
        </aside>
      </form>
    </>
  )
}
