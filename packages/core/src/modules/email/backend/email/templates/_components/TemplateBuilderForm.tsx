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
  sortOrder: string
  isActive: boolean
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

const systemVariables = [
  { key: 'companyName', label: 'Company name', sample: 'Harborview Analytics' },
  { key: 'companyCode', label: 'Company code', sample: 'HV-001' },
  { key: 'companyEmail', label: 'Company email', sample: 'info@harborviewanalytics.com' },
  { key: 'contactNames', label: 'Contact names', sample: 'Ms. Linh, Mr. David' },
  { key: 'recipientEmails', label: 'Recipient emails', sample: 'linh@example.com, david@example.com' },
  { key: 'greeting', label: 'Greeting', sample: 'Dear Ms. Linh and Mr. David,' },
] as const

const systemVariableKeys = new Set(systemVariables.map((variable) => variable.key))

export function customTemplateVariables(value: string): string[] {
  return splitCsv(value).filter((variable) => !systemVariableKeys.has(variable))
}

export function customTemplateValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(values)
    .filter(([key]) => !systemVariableKeys.has(key))
    .map(([key, value]) => [key, String(value)]))
}

export const starterTemplates: Record<string, Partial<TemplateBuilderFormValue>> = {
  quarterly_info: {
    templateKey: 'accounting.quarterly-info',
    name: 'Quarterly info request',
    subject: 'Quarterly accounting information request',
    preheader: 'Please send documents for the current quarter.',
    variables: 'quarterLabel, deadlineDate, uploadFolderUrl',
    fields: 'quarterLabel, deadlineDate, uploadFolderUrl',
    defaultValues: JSON.stringify({
      quarterLabel: 'Q3 2026',
      deadlineDate: '15 Oct 2026',
      uploadFolderUrl: 'https://example.com/company-upload-folder',
    }, null, 2),
    rules: JSON.stringify({ workflow: 'quarterly-info', requiresVatActivityCheck: false }, null, 2),
    workflowKey: 'quarterly-info',
    sortOrder: '1',
    isActive: true,
    blocks: [
      createBlock('heading', '[PCACS][{{companyCode}}] Accounting {{accountingPeriod}}'),
      createBlock('paragraph', '{{greeting}}\n\nA new quarter will come to an end soon. As required by law, we are to file the VAT and PIT declarations after preparing the legal accounting.'),
      createBlock('paragraph', 'Please prepare supporting documents, VAT invoices, bank statements for {{bankStatementPeriod}}, new commercial contracts, and receivable/payable tracking files.'),
      createBlock('button', 'Open upload folder', 'https://example.com/company-upload-folder'),
      createBlock('paragraph', 'Thank you very much for your support. We look forward to your report before {{submissionDeadline}}.\n\nBest regards,'),
    ],
  },
  quarterly_tax_activity: {
    templateKey: 'accounting.quarterly-tax-with-activity',
    name: 'Quarterly tax — with activity',
    subject: 'Quarterly tax filing — activity detected',
    variables: 'quarterLabel, salesSheetUrl, purchaseSheetUrl, deadlineDate',
    fields: 'quarterLabel, salesSheetUrl, purchaseSheetUrl, deadlineDate',
    defaultValues: JSON.stringify({
      quarterLabel: 'Q3 2026',
      salesSheetUrl: 'https://example.com/sales-sheet',
      purchaseSheetUrl: 'https://example.com/purchase-sheet',
      deadlineDate: '15 Oct 2026',
    }, null, 2),
    rules: JSON.stringify({ workflow: 'quarterly-tax', hasActivity: true }, null, 2),
    workflowKey: 'quarterly-tax',
    sortOrder: '2',
    isActive: true,
    blocks: [
      createBlock('heading', 'Quarterly tax filing'),
      createBlock('paragraph', '{{greeting}}\n\nFollowing the provided accounting supporting documents, PCA has prepared your accounting for {{quarterPeriod}}, including PIT declaration, VAT declaration, sales invoices report, expenses invoices report, and taxes obligations tracking.'),
      createBlock('paragraph', 'VAT and PIT reports: {{vatPitReportsLink}}\nTaxes obligations tracking: {{taxTrackingLink}}'),
      createBlock('paragraph', 'Declaration deadline: {{declarationDeadline}}\nVAT payable: {{vatPayable}}\nPIT payable: {{pitPayable}}\nTotal taxes to be paid: {{totalTaxPayable}}\nPayment deadline: {{paymentDeadline}}'),
    ],
  },
  quarterly_tax_no_activity: {
    templateKey: 'accounting.quarterly-tax-no-activity',
    name: 'Quarterly tax — no activity',
    subject: 'Quarterly tax filing — no activity confirmation',
    variables: 'quarterLabel, confirmationDeadline',
    fields: 'quarterLabel, confirmationDeadline',
    defaultValues: JSON.stringify({ quarterLabel: 'Q3 2026', confirmationDeadline: '15 Oct 2026' }, null, 2),
    rules: JSON.stringify({ workflow: 'quarterly-tax', hasActivity: false }, null, 2),
    workflowKey: 'quarterly-tax',
    sortOrder: '3',
    isActive: true,
    blocks: [
      createBlock('heading', 'No activity confirmation'),
      createBlock('paragraph', '{{greeting}}\n\nFollowing the provided accounting supporting documents, PCA has prepared your accounting for {{quarterPeriod}}.'),
      createBlock('paragraph', 'Please check the reports attached and let us know if anything needs to be amended:\nVAT and PIT reports: {{vatPitReportsLink}}\nTaxes obligations tracking: {{taxTrackingLink}}'),
      createBlock('paragraph', 'Declaration deadline: {{declarationDeadline}}\nTaxes payable: 0 VND'),
    ],
  },
  q3_cit: {
    templateKey: 'accounting.q3-cit',
    name: 'Q3 CIT reminder',
    subject: 'Q3 CIT preparation',
    variables: 'fiscalYear, citSheetUrl, deadlineDate',
    fields: 'fiscalYear, citSheetUrl, deadlineDate',
    defaultValues: JSON.stringify({ fiscalYear: '2026', citSheetUrl: 'https://example.com/cit-working-paper', deadlineDate: '31 Oct 2026' }, null, 2),
    rules: JSON.stringify({ workflow: 'cit', quarter: 'Q3' }, null, 2),
    workflowKey: 'cit-q3',
    sortOrder: '4',
    isActive: true,
    blocks: [createBlock('heading', 'Q3 CIT preparation'), createBlock('paragraph', '{{greeting}}\n\nPlease review the Q3 tax reports and provisional CIT report for {{citYear}}.'), createBlock('paragraph', 'VAT/PIT reports: {{vatPitReportsLink}}\nTax tracking: {{taxTrackingLink}}\nCIT report: {{citReportLink}}\nProvisional CIT: {{provisionalCit}}')],
  },
  q4_cit: {
    templateKey: 'accounting.q4-cit',
    name: 'Q4 CIT finalization',
    subject: 'Q4 CIT finalization',
    variables: 'fiscalYear, citSheetUrl, finalDeadline',
    fields: 'fiscalYear, citSheetUrl, finalDeadline',
    defaultValues: JSON.stringify({ fiscalYear: '2026', citSheetUrl: 'https://example.com/cit-final-working-paper', finalDeadline: '31 Mar 2027' }, null, 2),
    rules: JSON.stringify({ workflow: 'cit', quarter: 'Q4' }, null, 2),
    workflowKey: 'cit-q4',
    sortOrder: '5',
    isActive: true,
    blocks: [createBlock('heading', 'Q4 CIT finalization'), createBlock('paragraph', '{{greeting}}\n\nPlease review the Q4 tax reports and annual CIT payment details for {{citYear}}.'), createBlock('paragraph', 'VAT/PIT reports: {{vatPitReportsLink}}\nTax tracking: {{taxTrackingLink}}\nCIT report: {{citReportLink}}\nCIT payable: {{citPayable}}\nTotal taxes to be paid: {{totalTaxPayable}}')],
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

function formatFieldLabel(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (char) => char.toUpperCase())
}

function parseDefaultValues(value: string): Record<string, unknown> {
  try {
    return parseJsonObject(value, 'Default values')
  } catch {
    return {}
  }
}

function formatDefaultValues(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2)
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
  const subjectInputRef = React.useRef<HTMLInputElement>(null)
  const blockInputRefs = React.useRef<Record<string, HTMLTextAreaElement | null>>({})
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
  const availableFields = React.useMemo(() => {
    const fields = [...systemVariables.map((variable) => variable.key), ...splitCsv(value.fields), ...splitCsv(value.variables), 'taxQuarter']
    return [...new Set(fields.filter(Boolean))]
  }, [value.fields, value.variables])
  const variableRows = React.useMemo(() => customTemplateVariables(value.variables), [value.variables])
  const setVariables = (variables: string[], defaultValues = parseDefaultValues(value.defaultValues)) => {
    const uniqueVariables = [...new Set(variables.map((variable) => variable.trim()).filter(Boolean))]
    onChange({ ...value, variables: uniqueVariables.join(', '), defaultValues: formatDefaultValues(customTemplateValues(defaultValues)) })
  }
  const addVariable = () => {
    const existingVariables = new Set(variableRows)
    let nextName = 'newVariable'
    let suffix = 2
    while (existingVariables.has(nextName)) {
      nextName = `newVariable${suffix}`
      suffix += 1
    }
    setVariables([...variableRows, nextName], { ...parseDefaultValues(value.defaultValues), [nextName]: '' })
  }
  const updateVariableName = (index: number, nextName: string) => {
    const sanitizedName = nextName.trim().replace(/\s+/g, '')
    const currentName = variableRows[index]
    const nextVariables = variableRows.map((variable, variableIndex) => variableIndex === index ? sanitizedName : variable)
    const defaultValues = parseDefaultValues(value.defaultValues)
    if (currentName && currentName !== sanitizedName && Object.prototype.hasOwnProperty.call(defaultValues, currentName)) {
      defaultValues[sanitizedName] = defaultValues[currentName]
      delete defaultValues[currentName]
    }
    setVariables(nextVariables, defaultValues)
  }
  const updateVariableSample = (variableName: string, sampleValue: string) => {
    setField('defaultValues', formatDefaultValues({ ...parseDefaultValues(value.defaultValues), [variableName]: sampleValue }))
  }
  const removeVariable = (index: number) => {
    const currentName = variableRows[index]
    const defaultValues = parseDefaultValues(value.defaultValues)
    if (currentName) delete defaultValues[currentName]
    setVariables(variableRows.filter((_, variableIndex) => variableIndex !== index), defaultValues)
  }
  const insertIntoSubject = (field: string) => {
    const input = subjectInputRef.current
    const token = `{{${field}}}`
    const selectionStart = input?.selectionStart ?? value.subject.length
    const selectionEnd = input?.selectionEnd ?? selectionStart
    setField('subject', `${value.subject.slice(0, selectionStart)}${token}${value.subject.slice(selectionEnd)}`)
    window.requestAnimationFrame(() => {
      input?.focus()
      const cursorPosition = selectionStart + token.length
      input?.setSelectionRange(cursorPosition, cursorPosition)
    })
  }
  const insertIntoBlock = (index: number, field: string) => {
    const block = value.blocks[index]
    if (!block) return
    const input = blockInputRefs.current[block.id]
    const token = `{{${field}}}`
    const selectionStart = input?.selectionStart ?? block.content.length
    const selectionEnd = input?.selectionEnd ?? selectionStart
    updateBlock(index, { content: `${block.content.slice(0, selectionStart)}${token}${block.content.slice(selectionEnd)}` })
    window.requestAnimationFrame(() => {
      input?.focus()
      const cursorPosition = selectionStart + token.length
      input?.setSelectionRange(cursorPosition, cursorPosition)
    })
  }

  let sampleValues: Record<string, unknown> = {}
  let previewError: string | null = null
  try {
    sampleValues = parseJsonObject(value.defaultValues, 'Default values')
  } catch (err) {
    previewError = err instanceof Error ? err.message : 'Default values must be valid JSON'
  }
  sampleValues = Object.fromEntries(systemVariables.map((variable) => [variable.key, variable.sample]))
  Object.assign(sampleValues, customTemplateValues(parseDefaultValues(value.defaultValues)))
  const previewSubject = renderWithSamples(value.subject || 'Untitled subject', sampleValues)
  const previewHtml = renderWithSamples(blocksToHtml(value.blocks), sampleValues)

  return (
    <>
      {error ? <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
      <form className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,460px)]" onSubmit={onSubmit}>
        <div className="space-y-4 rounded-lg border bg-card p-4">
          {mode === 'create' ? (
            <label className="block text-sm font-medium">Start from template
              <select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" defaultValue="" onChange={(event) => {
                const starter = starterTemplates[event.target.value]
                if (starter) onChange({ ...value, ...starter, blocks: starter.blocks ?? value.blocks })
              }}>
                <option value="">Blank template</option>
                <option value="quarterly_info">Quarterly info request</option>
                <option value="quarterly_tax_activity">Quarterly tax — with activity</option>
                <option value="quarterly_tax_no_activity">Quarterly tax — no activity</option>
                <option value="q3_cit">Q3 CIT reminder</option>
                <option value="q4_cit">Q4 CIT finalization</option>
              </select>
              <span className="mt-1 block text-xs text-muted-foreground">Choose a PCA accounting preset to prefill the form, or keep a blank template and build it yourself.</span>
            </label>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">Template key<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.templateKey} onChange={(event) => setField('templateKey', event.target.value)} required /></label>
            <label className="block text-sm font-medium">Name<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.name} onChange={(event) => setField('name', event.target.value)} required /></label>
            <label className="block text-sm font-medium">Category<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.category} onChange={(event) => setField('category', event.target.value)} required /></label>
            <label className="block text-sm font-medium">Status<select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.status} onChange={(event) => setField('status', event.target.value as TemplateStatus)}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
          </div>
          <label className="block text-sm font-medium">Description<textarea className="mt-1 min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.description} onChange={(event) => setField('description', event.target.value)} /></label>
          <section className="space-y-3 rounded-md border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-medium">System variables</h2>
                <p className="text-xs text-muted-foreground">Filled automatically from the selected Operis company and linked people during email compose.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {systemVariables.map((variable) => (
                <span key={variable.key} className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium" title={variable.sample}>
                  {'{{'}{variable.key}{'}}'}
                </span>
              ))}
            </div>
          </section>
          <section className="space-y-3 rounded-md border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-medium">Custom accounting variables</h2>
                <p className="text-xs text-muted-foreground">Define only values that come from accounting context, rules, or manual input. Sample values are preview-only.</p>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={addVariable}>Add variable</Button>
            </div>
            <div className="space-y-2">
              {variableRows.length ? variableRows.map((variableName, index) => (
                <div key={`${variableName}-${index}`} className="grid gap-2 md:grid-cols-[minmax(160px,1fr)_minmax(180px,1fr)_auto]">
                  <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={variableName} onChange={(event) => updateVariableName(index, event.target.value)} placeholder="quarterLabel" />
                  <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={String(parseDefaultValues(value.defaultValues)[variableName] ?? '')} onChange={(event) => updateVariableSample(variableName, event.target.value)} placeholder="Sample preview value" />
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeVariable(index)}>Remove</Button>
                </div>
              )) : (
                <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">No custom variables yet. Use system variables for company/contact data, or add accounting fields like quarterLabel and deadlineDate.</div>
              )}
            </div>
          </section>
          <label className="block text-sm font-medium">Subject
            <div className="mt-1 flex gap-2">
              <input ref={subjectInputRef} className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.subject} onChange={(event) => setField('subject', event.target.value)} required />
              <select className="w-52 rounded-md border border-border bg-background px-3 py-2 text-sm" defaultValue="" onChange={(event) => {
                if (event.target.value) insertIntoSubject(event.target.value)
                event.target.value = ''
              }}>
                <option value="" disabled>Insert variable</option>
                {availableFields.map((field) => <option key={field} value={field}>{formatFieldLabel(field)}</option>)}
              </select>
            </div>
          </label>
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
                {block.type !== 'divider' ? (
                  <div className="space-y-2">
                    <textarea ref={(element) => { blockInputRefs.current[block.id] = element }} className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={block.content} onChange={(event) => updateBlock(index, { content: event.target.value })} placeholder="Use {{variables}} in content" />
                    <select className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" defaultValue="" onChange={(event) => {
                      if (event.target.value) insertIntoBlock(index, event.target.value)
                      event.target.value = ''
                    }}>
                      <option value="" disabled>Insert variable into this block</option>
                      {availableFields.map((field) => <option key={field} value={field}>{formatFieldLabel(field)}</option>)}
                    </select>
                  </div>
                ) : null}
                {block.type === 'button' ? <input className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={block.url} onChange={(event) => updateBlock(index, { url: event.target.value })} placeholder="https://example.com/link" /> : null}
              </div>
            ))}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">Custom variables CSV<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.variables} onChange={(event) => setField('variables', event.target.value)} placeholder="quarterLabel, deadlineDate" /><span className="mt-1 block text-xs text-muted-foreground">Advanced: synced with the custom variable rows above.</span></label>
            <label className="block text-sm font-medium">Accounting fields<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.fields} onChange={(event) => setField('fields', event.target.value)} placeholder="quarterLabel, deadlineDate" /></label>
          </div>
          <label className="block text-sm font-medium">Workflow key<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.workflowKey} onChange={(event) => setField('workflowKey', event.target.value)} /></label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">Display order<input type="number" min={0} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.sortOrder} onChange={(event) => setField('sortOrder', event.target.value)} /></label>
            <label className="mt-7 flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4" checked={value.isActive} onChange={(event) => setField('isActive', event.target.checked)} /> Show in accounting generator</label>
          </div>
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
