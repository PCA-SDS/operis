'use client'

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'

export type TemplateStatus = 'draft' | 'published' | 'archived'
export type BlockType = 'heading' | 'paragraph' | 'button' | 'divider' | 'rich-text-html'
export type VariableType = 'text' | 'link' | 'date' | 'number' | 'money' | 'email'

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
  variableTypes: string
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

const systemVariableKeys: ReadonlySet<string> = new Set(systemVariables.map((variable) => variable.key))
const variableTypes: VariableType[] = ['text', 'link', 'date', 'number', 'money', 'email']
const variableTypeHelp: Record<VariableType, string> = {
  text: 'Plain text value inserted into subject/body.',
  link: 'URL value rendered as a clickable link in preview and final HTML.',
  date: 'Date-like value for deadlines or periods.',
  number: 'Numeric value for counts or references.',
  money: 'Currency amount such as tax payable.',
  email: 'Email address value.',
}

export function customTemplateVariables(value: string): string[] {
  return splitCsv(value).filter((variable) => !systemVariableKeys.has(variable))
}

export function customTemplateValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(values)
    .filter(([key]) => !systemVariableKeys.has(key))
    .map(([key, value]) => [key, String(value)]))
}

export function createStaticBlock(id: string, type: BlockType, content = '', url = ''): TemplateBlockFormValue {
  return {
    id,
    type,
    label: type === 'button' ? 'Button' : type === 'heading' ? 'Heading' : type === 'divider' ? 'Divider' : type === 'rich-text-html' ? 'Rich text' : 'Body text',
    content,
    url,
  }
}

export function createBlock(type: BlockType, content = '', url = ''): TemplateBlockFormValue {
  return createStaticBlock(`block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, content, url)
}

export function splitCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

export function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value || '{}') as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`[internal] ${label} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

export function buildTemplateBlocks(blocks: TemplateBlockFormValue[]) {
  return blocks.map((block, index) => ({
    id: block.id || `block-${index + 1}`,
    type: block.type,
    label: block.label || block.type,
    props: {
      ...(block.type === 'rich-text-html' ? { html: block.content } : { text: block.content }),
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

function sanitizeHref(value: string): string {
  return /^https?:\/\//i.test(value) ? value : '#'
}

export function renderHtmlPreviewWithSamples(value: string, samples: Record<string, unknown>, types: Record<string, VariableType>): string {
  return value.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key: string, offset: number, source: string) => {
    const sample = String(samples[key] ?? `{{${key}}}`)
    const before = source.slice(Math.max(0, offset - 120), offset).toLowerCase()
    const after = source.slice(offset, offset + 120).toLowerCase()
    const alreadyInsideAnchor = before.lastIndexOf('<a ') > before.lastIndexOf('</a>') && after.includes('</a>')
    const isLink = types[key] === 'link' || /(?:url|link)$/i.test(key) || /^https?:\/\//i.test(sample)
    if (!isLink || alreadyInsideAnchor) return escapeHtml(sample)
    return `<a href="${escapeHtml(sanitizeHref(sample))}" target="_blank" rel="noopener noreferrer">${escapeHtml(key)}</a>`
  })
}

export function parseVariableTypes(value: string): Record<string, VariableType> {
  try {
    const parsed = parseJsonObject(value, 'Variable types')
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, VariableType] => variableTypes.includes(entry[1] as VariableType)))
  } catch {
    return {}
  }
}

type RuleValue = string | boolean

function parseRules(value: string): Record<string, RuleValue> {
  try {
    const parsed = parseJsonObject(value, 'Rules')
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, RuleValue] => {
        const [, entryValue] = entry
        return typeof entryValue === 'string' || typeof entryValue === 'boolean'
      }),
    )
  } catch {
    return {}
  }
}

function formatRules(value: Record<string, RuleValue>): string {
  const cleaned = Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== 'any' && entryValue !== ''))
  return JSON.stringify(cleaned, null, 2)
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

function HelpLabel({ children, help }: { children: React.ReactNode; help: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{children}</span>
      <span className="group relative inline-flex">
        <button
          type="button"
          aria-label={help}
          className="inline-flex size-4 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
        >
          i
        </button>
        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden w-64 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs font-normal text-popover-foreground shadow-md group-hover:block group-focus-within:block">
          {help}
        </span>
      </span>
    </span>
  )
}

async function copyText(value: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  await navigator.clipboard.writeText(value)
}

async function copyHtml(html: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  const plainText = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (typeof ClipboardItem !== 'undefined') {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      }),
    ])
    return
  }
  await navigator.clipboard.writeText(plainText)
}

export function TemplateBuilderForm({ mode, value, error, isSaving, onChange, onSubmit, onDelete }: TemplateBuilderFormProps) {
  const t = useT()
  const latestValueRef = React.useRef(value)
  const subjectInputRef = React.useRef<HTMLInputElement>(null)
  const blockInputRefs = React.useRef<Record<string, HTMLTextAreaElement | null>>({})
  const [copied, setCopied] = React.useState<'subject' | 'body' | null>(null)
  latestValueRef.current = value
  const patchValue = (patch: Partial<TemplateBuilderFormValue>) => {
    onChange({ ...latestValueRef.current, ...patch })
  }
  const setField = <K extends keyof TemplateBuilderFormValue>(key: K, fieldValue: TemplateBuilderFormValue[K]) => {
    patchValue({ [key]: fieldValue })
  }
  const updateBlock = (index: number, patch: Partial<TemplateBlockFormValue>) => {
    const current = latestValueRef.current
    onChange({ ...current, blocks: current.blocks.map((block, blockIndex) => blockIndex === index ? { ...block, ...patch } : block) })
  }
  const addBlock = (block: TemplateBlockFormValue) => {
    const current = latestValueRef.current
    onChange({ ...current, blocks: [...current.blocks, block] })
  }
  const removeBlock = (index: number) => {
    const current = latestValueRef.current
    onChange({ ...current, blocks: current.blocks.filter((_, blockIndex) => blockIndex !== index) })
  }
  const moveBlock = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    const current = latestValueRef.current
    if (nextIndex < 0 || nextIndex >= current.blocks.length) return
    const next = [...current.blocks]
    const [block] = next.splice(index, 1)
    if (!block) return
    next.splice(nextIndex, 0, block)
    onChange({ ...current, blocks: next })
  }
  const availableFields = React.useMemo(() => {
    const fields = [...systemVariables.map((variable) => variable.key), ...splitCsv(value.fields), ...splitCsv(value.variables), 'taxQuarter']
    return [...new Set(fields.filter(Boolean))]
  }, [value.fields, value.variables])
  const variableRows = React.useMemo(() => customTemplateVariables(value.variables), [value.variables])
  const parsedVariableTypes = React.useMemo(() => parseVariableTypes(value.variableTypes), [value.variableTypes])
  const parsedRules = React.useMemo(() => parseRules(value.rules), [value.rules])
  const updateRule = (key: string, ruleValue: RuleValue) => {
    setField('rules', formatRules({ ...parsedRules, [key]: ruleValue }))
  }
  const updateWorkflow = (workflowKey: string) => {
    onChange({
      ...latestValueRef.current,
      workflowKey,
      rules: formatRules({ ...parsedRules, type: workflowKey }),
    })
  }
  const setVariables = (variables: string[], defaultValues = parseDefaultValues(value.defaultValues), nextTypes = parsedVariableTypes) => {
    const uniqueVariables = [...new Set(variables.map((variable) => variable.trim()).filter(Boolean))]
    const filteredTypes = Object.fromEntries(uniqueVariables.map((variable) => [variable, nextTypes[variable] ?? 'text']))
    onChange({ ...latestValueRef.current, variables: uniqueVariables.join(', '), defaultValues: formatDefaultValues(customTemplateValues(defaultValues)), variableTypes: JSON.stringify(filteredTypes, null, 2) })
  }
  const addVariable = () => {
    const existingVariables = new Set(variableRows)
    let nextName = 'newVariable'
    let suffix = 2
    while (existingVariables.has(nextName)) {
      nextName = `newVariable${suffix}`
      suffix += 1
    }
    setVariables([...variableRows, nextName], { ...parseDefaultValues(value.defaultValues), [nextName]: '' }, { ...parsedVariableTypes, [nextName]: 'text' })
  }
  const updateVariableName = (index: number, nextName: string) => {
    const sanitizedName = nextName.trim().replace(/\s+/g, '')
    const currentName = variableRows[index]
    const nextVariables = variableRows.map((variable, variableIndex) => variableIndex === index ? sanitizedName : variable)
    const defaultValues = parseDefaultValues(value.defaultValues)
    const nextTypes = { ...parsedVariableTypes }
    if (currentName && currentName !== sanitizedName) {
      if (Object.prototype.hasOwnProperty.call(defaultValues, currentName)) {
        defaultValues[sanitizedName] = defaultValues[currentName]
        delete defaultValues[currentName]
      }
      if (Object.prototype.hasOwnProperty.call(nextTypes, currentName)) {
        nextTypes[sanitizedName] = nextTypes[currentName] ?? 'text'
        delete nextTypes[currentName]
      }
    }
    setVariables(nextVariables, defaultValues, nextTypes)
  }
  const updateVariableSample = (variableName: string, sampleValue: string) => {
    setField('defaultValues', formatDefaultValues({ ...parseDefaultValues(value.defaultValues), [variableName]: sampleValue }))
  }
  const updateVariableType = (variableName: string, type: VariableType) => {
    setField('variableTypes', JSON.stringify({ ...parsedVariableTypes, [variableName]: type }, null, 2))
  }
  const removeVariable = (index: number) => {
    const currentName = variableRows[index]
    const defaultValues = parseDefaultValues(value.defaultValues)
    const nextTypes = { ...parsedVariableTypes }
    if (currentName) {
      delete defaultValues[currentName]
      delete nextTypes[currentName]
    }
    setVariables(variableRows.filter((_, variableIndex) => variableIndex !== index), defaultValues, nextTypes)
  }
  const insertIntoSubject = (field: string) => {
    const current = latestValueRef.current
    const input = subjectInputRef.current
    const token = `{{${field}}}`
    const selectionStart = input?.selectionStart ?? current.subject.length
    const selectionEnd = input?.selectionEnd ?? selectionStart
    patchValue({ subject: `${current.subject.slice(0, selectionStart)}${token}${current.subject.slice(selectionEnd)}` })
    window.requestAnimationFrame(() => {
      input?.focus()
      const cursorPosition = selectionStart + token.length
      input?.setSelectionRange(cursorPosition, cursorPosition)
    })
  }
  const insertIntoBlock = (index: number, field: string) => {
    const current = latestValueRef.current
    const block = current.blocks[index]
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
  const previewHtml = renderHtmlPreviewWithSamples(blocksToHtml(value.blocks), sampleValues, parsedVariableTypes)

  return (
    <>
      {error ? <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
      <form className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,460px)]" onSubmit={onSubmit}>
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.templateKey.help', 'Unique code used by automation and imports. Use lowercase letters, numbers, dots, dashes, or underscores.')}>{t('email.templates.form.templateKey.label', 'Template key')}</HelpLabel><input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.templateKey} onChange={(event) => setField('templateKey', event.target.value)} required /></label>
            <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.name.help', 'Human-friendly name shown to users when choosing a template.')}>{t('email.templates.form.name.label', 'Name')}</HelpLabel><input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.name} onChange={(event) => setField('name', event.target.value)} required /></label>
            <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.category.help', 'Groups templates for browsing. Accounting templates usually use accounting.')}>{t('email.templates.form.category.label', 'Category')}</HelpLabel><input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.category} onChange={(event) => setField('category', event.target.value)} required /></label>
            <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.status.help', 'Draft templates are editable, published templates are selectable in compose, archived templates are hidden from normal use.')}>{t('email.templates.form.status.label', 'Status')}</HelpLabel><select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.status} onChange={(event) => setField('status', event.target.value as TemplateStatus)}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
          </div>
          <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.description.help', 'Short internal note explaining when this template is useful.')}>{t('email.templates.form.description.label', 'Description')}</HelpLabel><textarea className="mt-1 min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.description} onChange={(event) => setField('description', event.target.value)} /></label>
          <section className="space-y-3 rounded-md border border-border bg-background p-3">
            <div>
              <h2 className="font-medium"><HelpLabel help={t('email.templates.form.whenToUse.help', 'These choices are saved as rule metadata for future workflow selection. They do not send email or auto-select templates yet.')}>{t('email.templates.form.whenToUse.label', 'When to use this template')}</HelpLabel></h2>
              <p className="text-xs text-muted-foreground">{t('email.templates.form.whenToUse.description', 'Choose simple business conditions instead of editing raw rules JSON.')}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.workflow.help', 'Main accounting workflow where this template should appear later.')}>{t('email.templates.form.workflow.label', 'Email purpose')}</HelpLabel><select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.workflowKey || String(parsedRules.type ?? '')} onChange={(event) => updateWorkflow(event.target.value)}><option value="">{t('email.templates.form.workflow.any', 'Any accounting email')}</option><option value="request_documents">{t('email.templates.form.workflow.requestDocuments', 'Request documents')}</option><option value="tax_report">{t('email.templates.form.workflow.taxReport', 'Tax report')}</option></select></label>
              <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.quarter.help', 'Optional quarter condition used later by accounting workflow selection.')}>{t('email.templates.form.quarter.label', 'Quarter')}</HelpLabel><select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={String(parsedRules.quarter ?? 'any')} onChange={(event) => updateRule('quarter', event.target.value)}><option value="any">{t('email.templates.form.quarter.any', 'Any quarter')}</option><option value="Q1">Q1</option><option value="Q2">Q2</option><option value="Q3">Q3</option><option value="Q4">Q4</option></select></label>
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4" checked={parsedRules.hasActivity === true} onChange={(event) => updateRule('hasActivity', event.target.checked)} /> <HelpLabel help={t('email.templates.form.hasActivity.help', 'Marks this template for companies with accounting/tax activity in the period.')}>{t('email.templates.form.hasActivity.label', 'Company has activity')}</HelpLabel></label>
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4" checked={parsedRules.hasCit === true} onChange={(event) => updateRule('hasCit', event.target.checked)} /> <HelpLabel help={t('email.templates.form.hasCit.help', 'Marks this template for Corporate Income Tax messages.')}>{t('email.templates.form.hasCit.label', 'Includes CIT')}</HelpLabel></label>
              <label className="block text-sm font-medium md:col-span-2"><HelpLabel help={t('email.templates.form.priority.help', 'Lower numbers appear first when multiple templates match later.')}>{t('email.templates.form.priority.label', 'Selection priority')}</HelpLabel><input type="number" min="0" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.sortOrder} onChange={(event) => setField('sortOrder', event.target.value)} /></label>
            </div>
          </section>
          <section className="space-y-3 rounded-md border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-medium"><HelpLabel help={t('email.templates.form.systemVariables.help', 'Read-only placeholders filled automatically from the selected company and linked people.')}>{t('email.templates.form.systemVariables.label', 'System variables')}</HelpLabel></h2>
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
                <h2 className="font-medium"><HelpLabel help={t('email.templates.form.customVariables.help', 'User-defined accounting values, such as deadlines, tax amounts, or document links.')}>{t('email.templates.form.customVariables.label', 'Custom variables')}</HelpLabel></h2>
                <p className="text-xs text-muted-foreground">Define only values that come from accounting context, rules, or manual input. Sample values are preview-only.</p>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={addVariable}>Add variable</Button>
            </div>
            <div className="space-y-2">
              {variableRows.length ? (
                <div className="hidden grid-cols-[minmax(150px,1fr)_140px_minmax(180px,1fr)_auto] gap-2 px-1 text-xs font-medium text-muted-foreground md:grid">
                  <HelpLabel help={t('email.templates.form.variableKey.help', 'Placeholder name inserted as {{variableName}} in the subject or body.')}>{t('email.templates.form.variableKey.label', 'Variable key')}</HelpLabel>
                  <HelpLabel help={t('email.templates.form.variableType.help', 'Controls how this sample value is previewed, for example link variables render as clickable links.')}>{t('email.templates.form.variableType.label', 'Type')}</HelpLabel>
                  <HelpLabel help={t('email.templates.form.variableSample.help', 'Example value used only in the live preview. It is not a real customer value.')}>{t('email.templates.form.variableSample.label', 'Preview value')}</HelpLabel>
                  <span />
                </div>
              ) : null}
              {variableRows.length ? variableRows.map((variableName, index) => (
                <div key={index} className="grid gap-2 md:grid-cols-[minmax(150px,1fr)_140px_minmax(180px,1fr)_auto]">
                  <input aria-label="Variable key" className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={variableName} onChange={(event) => updateVariableName(index, event.target.value)} placeholder="uploadFolderUrl" />
                  <select aria-label="Variable type" className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={parsedVariableTypes[variableName] ?? 'text'} onChange={(event) => updateVariableType(variableName, event.target.value as VariableType)}>
                    {variableTypes.map((type) => <option key={type} value={type}>{formatFieldLabel(type)}</option>)}
                  </select>
                  <input aria-label="Sample preview value" className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={String(parseDefaultValues(value.defaultValues)[variableName] ?? '')} onChange={(event) => updateVariableSample(variableName, event.target.value)} placeholder={(parsedVariableTypes[variableName] ?? 'text') === 'link' ? 'https://example.com/folder' : 'Sample preview value'} />
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeVariable(index)}>Remove</Button>
                  <p className="md:col-span-4 text-xs text-muted-foreground">{variableTypeHelp[parsedVariableTypes[variableName] ?? 'text']}</p>
                </div>
              )) : (
                <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">No custom variables yet. Use system variables for company/contact data, or add accounting fields like quarterLabel and deadlineDate.</div>
              )}
            </div>
          </section>
          <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.subject.help', 'Email subject line. Insert variables to personalize it during compose.')}>{t('email.templates.form.subject.label', 'Subject')}</HelpLabel>
            <div className="mt-1 flex gap-2">
              <input ref={subjectInputRef} className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.subject} onChange={(event) => setField('subject', event.target.value)} required />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
              <span className="text-muted-foreground">Insert variable:</span>
              {availableFields.map((field) => (
                <Button key={field} type="button" size="sm" variant="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => insertIntoSubject(field)}>
                  {'{{'}{field}{'}}'}
                </Button>
              ))}
            </div>
          </label>
          <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.preheader.help', 'Short preview text some email clients show under the subject.')}>{t('email.templates.form.preheader.label', 'Preheader')}</HelpLabel><input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={value.preheader} onChange={(event) => setField('preheader', event.target.value)} /></label>

          <section className="space-y-3 rounded-md border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="font-medium"><HelpLabel help={t('email.templates.form.blocks.help', 'Build the email body from reusable blocks. Rich text blocks allow selected-text typography.')}>{t('email.templates.form.blocks.label', 'Visual builder blocks')}</HelpLabel></h2><p className="text-xs text-muted-foreground">Editable blocks are stored as template blocks; rich text blocks support selected-text typography.</p></div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => addBlock(createBlock('heading', 'New heading'))}>Heading</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => addBlock(createBlock('rich-text-html', '<p>New rich text</p>'))}>Rich text</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => addBlock(createBlock('paragraph', 'New paragraph'))}>Plain text</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => addBlock(createBlock('button', 'Open link', 'https://example.com/link'))}>Button</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => addBlock(createBlock('divider'))}>Divider</Button>
              </div>
            </div>
            {value.blocks.map((block, index) => (
              <div key={block.id} className="space-y-2 rounded-md border border-border p-3">
                <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)_auto]">
                  <select className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={block.type} onChange={(event) => updateBlock(index, { type: event.target.value as BlockType })}>
                    <option value="heading">Heading</option><option value="rich-text-html">Rich text</option><option value="paragraph">Plain text</option><option value="button">Button</option><option value="divider">Divider</option>
                  </select>
                  <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={block.label} onChange={(event) => updateBlock(index, { label: event.target.value })} placeholder="Block label" />
                  <div className="flex gap-1"><Button type="button" size="sm" variant="ghost" onClick={() => moveBlock(index, -1)}>↑</Button><Button type="button" size="sm" variant="ghost" onClick={() => moveBlock(index, 1)}>↓</Button><Button type="button" size="sm" variant="ghost" onClick={() => removeBlock(index)}>Remove</Button></div>
                </div>
                {block.type !== 'divider' ? (
                  <div className="space-y-2">
                    {block.type === 'rich-text-html' ? (
                      <>
                        <p className="text-xs text-muted-foreground">Select part of the email body, then use the toolbar for headings, size, color, bold, lists, alignment, links, and other typography.</p>
                        <RichEditor value={block.content} onChange={(content) => updateBlock(index, { content })} variant="full" minRows={8} placeholder="Write your email body here. Use {{variables}} in content." />
                      </>
                    ) : (
                      <textarea ref={(element) => { blockInputRefs.current[block.id] = element }} className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={block.content} onChange={(event) => updateBlock(index, { content: event.target.value })} placeholder="Use {{variables}} in content" />
                    )}
                    <div className="flex flex-wrap items-center gap-1 text-xs">
                      <span className="text-muted-foreground">Insert variable:</span>
                      {availableFields.map((field) => (
                        <Button key={field} type="button" size="sm" variant="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => {
                          const currentBlock = latestValueRef.current.blocks[index]
                          if (!currentBlock) return
                          if (currentBlock.type === 'rich-text-html') updateBlock(index, { content: `${currentBlock.content}<p>${escapeHtml(`{{${field}}}`)}</p>` })
                          else insertIntoBlock(index, field)
                        }}>
                          {'{{'}{field}{'}}'}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {block.type === 'button' ? <input className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={block.url} onChange={(event) => updateBlock(index, { url: event.target.value })} placeholder="https://example.com/link" /> : null}
              </div>
            ))}
          </section>

          <input type="hidden" value={value.fields} readOnly />
          <input type="hidden" value={value.sortOrder} readOnly />
          <input type="hidden" value={value.workflowKey} readOnly />
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4" checked={value.isActive} onChange={(event) => setField('isActive', event.target.checked)} /> <HelpLabel help={t('email.templates.form.showInGenerator.help', 'Controls whether accounting compose/generator screens can offer this template when status allows it.')}>{t('email.templates.form.showInGenerator.label', 'Show in accounting generator')}</HelpLabel></label>
          <div className="flex justify-between gap-2">
            {mode === 'edit' && onDelete ? <Button type="button" variant="destructive" disabled={isSaving} onClick={onDelete}>{t('email.common.delete', 'Delete')}</Button> : <span />}
            <div className="flex gap-2"><Button type="button" variant="secondary" asChild><Link href="/backend/email/templates">{t('email.common.cancel', 'Cancel')}</Link></Button><Button type="submit" disabled={isSaving}>{isSaving ? t('email.common.saving', 'Saving…') : mode === 'create' ? t('email.templates.form.createSubmit', 'Create Template') : t('email.templates.form.saveSubmit', 'Save Template')}</Button></div>
          </div>
        </div>
        <aside className="space-y-4 self-start rounded-lg border bg-card p-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-auto">
          <div><h2 className="font-semibold"><HelpLabel help={t('email.templates.preview.help', 'Shows how the subject and body will look using sample values. Use Compose Preview later to choose a specific company.')}>{t('email.templates.preview.title', 'Live preview')}</HelpLabel></h2><p className="text-sm text-muted-foreground">{t('email.templates.preview.description', 'Preview uses sample/default values only and does not send email.')}</p></div>
          {previewError ? <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{previewError}</div> : null}
          <div className="rounded-md border bg-background p-3">
            <div className="flex items-center justify-between gap-2"><div className="text-xs uppercase text-muted-foreground">{t('email.templates.form.subject.label', 'Subject')}</div><Button type="button" size="sm" variant="ghost" onClick={copyPreviewSubject}>{copied === 'subject' ? t('email.common.copied', 'Copied') : t('email.templates.preview.copySubject', 'Copy subject')}</Button></div>
            <div className="mt-1 font-medium">{previewSubject}</div>{value.preheader ? <div className="mt-1 text-sm text-muted-foreground">{renderWithSamples(value.preheader, sampleValues)}</div> : null}
          </div>
          <div className="rounded-md border bg-background p-3">
            <div className="flex items-center justify-between gap-2"><div className="text-xs uppercase text-muted-foreground">{t('email.templates.preview.emailBody', 'Email body')}</div><Button type="button" size="sm" variant="ghost" onClick={copyPreviewBody}>{copied === 'body' ? t('email.common.copied', 'Copied') : t('email.templates.preview.copyBody', 'Copy body')}</Button></div>
            <iframe className="mt-2 h-96 w-full rounded border bg-white" sandbox="" srcDoc={`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;padding:16px">${previewHtml}</body></html>`} title={t('email.templates.preview.iframeTitle', 'Email template preview')} />
          </div>
        </aside>
      </form>
    </>
  )
}
