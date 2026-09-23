'use client'

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { HelpLabel } from '../../../../components/HelpLabel'
import { copyHtml, copyText } from '../../../../components/clipboard'
import {
  blocksToHtml,
  createBlock,
  customTemplateValues,
  customTemplateVariables,
  escapeHtml,
  parseJsonObject,
  parseVariableTypes,
  renderHtmlPreviewWithSamples,
  renderWithSamples,
  splitCsv,
  systemVariables,
  variableTypes,
  type BlockType,
  type TemplateBlockFormValue,
  type TemplateStatus,
  type VariableType,
} from '../../../../components/templateHtml'
import { type TemplateBuilderFormValue } from '../../../../components/templatePayload'
import { FIELD_CLASS, PANEL_CLASS, PREVIEW_FRAME_CLASS, SUBPANEL_CLASS, previewDocument } from '../../../../components/formStyles'

export type { BlockType, TemplateBlockFormValue, TemplateBuilderFormValue, TemplateStatus, VariableType }

type TemplateBuilderFormProps = {
  mode: 'create' | 'edit'
  value: TemplateBuilderFormValue
  error: string | null
  isSaving: boolean
  onChange: (value: TemplateBuilderFormValue) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onDelete?: () => void
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

function variableTypeLabel(t: ReturnType<typeof useT>, type: VariableType): string {
  return t(`email.templates.form.variableTypes.${type}`, formatFieldLabel(type))
}

function variableTypeHelp(t: ReturnType<typeof useT>, type: VariableType): string {
  return t(`email.templates.form.variableTypes.${type}.help`, '')
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

export function TemplateBuilderForm({ mode, value, error, isSaving, onChange, onSubmit, onDelete }: TemplateBuilderFormProps) {
  const t = useT()
  const latestValueRef = React.useRef(value)
  const subjectInputRef = React.useRef<HTMLInputElement>(null)
  const blockInputRefs = React.useRef<Record<string, HTMLTextAreaElement | null>>({})
  const [copied, setCopied] = React.useState<'subject' | 'body' | null>(null)
  latestValueRef.current = value
  const blockTypeLabels: Record<BlockType, string> = {
    heading: t('email.templates.blocks.heading', 'Heading'),
    'rich-text-html': t('email.templates.blocks.richText', 'Rich text'),
    paragraph: t('email.templates.blocks.plainText', 'Plain text'),
    button: t('email.templates.blocks.button', 'Button'),
    divider: t('email.templates.blocks.divider', 'Divider'),
  }
  const linkFallbackLabel = t('email.templates.blocks.openLink', 'Open link')
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
  const addBlock = (type: BlockType, content = '', url = '') => {
    const current = latestValueRef.current
    onChange({ ...current, blocks: [...current.blocks, createBlock(type, content, url, blockTypeLabels[type])] })
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
  const canShowInGenerator = value.status === 'published'
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

  let previewError: string | null = null
  try {
    // Parsed for validation only — the value is rebuilt from the system
    // variables below, so the old assignment here was dead.
    parseJsonObject(value.defaultValues, 'Default values')
  } catch (err) {
    // parseJsonObject throws an `[internal]`-prefixed message; that marker means
    // "not user-facing", and the sibling edit page already strips it before display.
    previewError = err instanceof Error
      ? err.message.replace(/^\[internal]\s*/, '')
      : t('email.templates.errors.defaultValuesJson', 'Default values must be valid JSON')
  }
  const sampleValues: Record<string, unknown> = Object.fromEntries(systemVariables.map((variable) => [variable.key, variable.sample]))
  Object.assign(sampleValues, customTemplateValues(parseDefaultValues(value.defaultValues)))
  const previewSubject = renderWithSamples(value.subject || t('email.templates.preview.untitledSubject', 'Untitled subject'), sampleValues)
  const previewHtml = renderHtmlPreviewWithSamples(blocksToHtml(value.blocks, linkFallbackLabel), sampleValues, parsedVariableTypes)
  const copyPreviewSubject = async () => {
    await copyText(previewSubject)
    setCopied('subject')
    window.setTimeout(() => setCopied(null), 1500)
  }
  const copyPreviewBody = async () => {
    await copyHtml(previewHtml)
    setCopied('body')
    window.setTimeout(() => setCopied(null), 1500)
  }

  return (
    <>
      {error ? <ErrorMessage className="mb-4" label={error} /> : null}
      <form className="grid w-full max-w-full min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,460px)]" onSubmit={onSubmit}>
        <div className="w-full max-w-full min-w-0 space-y-4 rounded-lg border bg-surface p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.templateKey.help', 'Unique code used by automation and imports. Use lowercase letters, numbers, dots, dashes, or underscores.')}>{t('email.templates.form.templateKey.label', 'Template key')}</HelpLabel><Input className="mt-1" value={value.templateKey} onChange={(event) => setField('templateKey', event.target.value)} required /></label>
            <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.name.help', 'Human-friendly name shown to users when choosing a template.')}>{t('email.templates.form.name.label', 'Name')}</HelpLabel><Input className="mt-1" value={value.name} onChange={(event) => setField('name', event.target.value)} required /></label>
            <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.category.help', 'Groups templates for browsing. Accounting templates usually use accounting.')}>{t('email.templates.form.category.label', 'Category')}</HelpLabel><Input className="mt-1" value={value.category} onChange={(event) => setField('category', event.target.value)} required /></label>
            <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.status.help', 'Draft templates are editable, published templates are selectable in compose, archived templates are hidden from normal use.')}>{t('email.templates.form.status.label', 'Status')}</HelpLabel><select className={`mt-1 ${FIELD_CLASS}`} value={value.status} onChange={(event) => setField('status', event.target.value as TemplateStatus)}><option value="draft">{t('email.templates.status.draft', 'Draft')}</option><option value="published">{t('email.templates.status.published', 'Published')}</option><option value="archived">{t('email.templates.status.archived', 'Archived')}</option></select><span className="mt-1 block text-xs text-muted-foreground">{value.status === 'published' ? t('email.templates.form.status.publishedHelp', 'Published templates can appear in Compose Email when enabled below.') : value.status === 'archived' ? t('email.templates.form.status.archivedHelp', 'Archived templates stay hidden from Compose Email.') : t('email.templates.form.status.draftHelp', 'Draft templates are saved for editing and stay hidden from Compose Email.')}</span></label>
          </div>
          <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.description.help', 'Short internal note explaining when this template is useful.')}>{t('email.templates.form.description.label', 'Description')}</HelpLabel><Textarea className="mt-1 min-h-20" value={value.description} onChange={(event) => setField('description', event.target.value)} /></label>
          <section className={PANEL_CLASS}>
            <div>
              <h2 className="font-medium"><HelpLabel help={t('email.templates.form.whenToUse.help', 'These choices are saved as rule metadata for future workflow selection. They do not send email or auto-select templates yet.')}>{t('email.templates.form.whenToUse.label', 'When to use this template')}</HelpLabel></h2>
              <p className="max-w-full whitespace-normal break-words text-xs text-muted-foreground">{t('email.templates.form.whenToUse.description', 'Choose simple business conditions instead of editing raw rules JSON.')}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.workflow.help', 'Main accounting workflow where this template should appear later.')}>{t('email.templates.form.workflow.label', 'Email purpose')}</HelpLabel><select className={`mt-1 ${FIELD_CLASS}`} value={value.workflowKey || String(parsedRules.type ?? '')} onChange={(event) => updateWorkflow(event.target.value)}><option value="">{t('email.templates.form.workflow.any', 'Any accounting email')}</option><option value="request_documents">{t('email.templates.form.workflow.requestDocuments', 'Request documents')}</option><option value="tax_report">{t('email.templates.form.workflow.taxReport', 'Tax report')}</option></select></label>
              <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.quarter.help', 'Optional quarter condition used later by accounting workflow selection.')}>{t('email.templates.form.quarter.label', 'Quarter')}</HelpLabel><select className={`mt-1 ${FIELD_CLASS}`} value={String(parsedRules.quarter ?? 'any')} onChange={(event) => updateRule('quarter', event.target.value)}><option value="any">{t('email.templates.form.quarter.any', 'Any quarter')}</option><option value="Q1">Q1</option><option value="Q2">Q2</option><option value="Q3">Q3</option><option value="Q4">Q4</option></select></label>
              <label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={parsedRules.hasActivity === true} onCheckedChange={(checked) => updateRule('hasActivity', checked === true)} /> <HelpLabel help={t('email.templates.form.hasActivity.help', 'Marks this template for companies with accounting/tax activity in the period.')}>{t('email.templates.form.hasActivity.label', 'Company has activity')}</HelpLabel></label>
              <label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={parsedRules.hasCit === true} onCheckedChange={(checked) => updateRule('hasCit', checked === true)} /> <HelpLabel help={t('email.templates.form.hasCit.help', 'Marks this template for Corporate Income Tax messages.')}>{t('email.templates.form.hasCit.label', 'Includes CIT')}</HelpLabel></label>
              <label className="block text-sm font-medium md:col-span-2"><HelpLabel help={t('email.templates.form.priority.help', 'Lower numbers appear first when multiple templates match later.')}>{t('email.templates.form.priority.label', 'Selection priority')}</HelpLabel><Input type="number" min="0" className="mt-1" value={value.sortOrder} onChange={(event) => setField('sortOrder', event.target.value)} /></label>
            </div>
            <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.ruleNotes.help', 'Plain-language notes for staff, such as when to choose this template or what values to check before copying.')}>{t('email.templates.form.ruleNotes.label', 'Rule notes')}</HelpLabel><Textarea className="mt-1 min-h-20" value={value.ruleNotes} onChange={(event) => setField('ruleNotes', event.target.value)} placeholder={t('email.templates.form.ruleNotes.placeholder', 'Example: Use this for Q4 annual CIT finalization after reports are ready.')} /></label>
          </section>
          <section className={PANEL_CLASS}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-medium"><HelpLabel help={t('email.templates.form.systemVariables.help', 'Read-only placeholders filled automatically from the selected company and linked people.')}>{t('email.templates.form.systemVariables.label', 'System variables')}</HelpLabel></h2>
                <p className="max-w-full whitespace-normal break-words text-xs text-muted-foreground">{t('email.templates.form.systemVariables.description', 'Filled automatically from the selected Operis company and linked people during email compose.')}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {systemVariables.map((variable) => (
                <span key={variable.key} className="rounded-full border border-border bg-surface-muted px-2.5 py-1 text-xs font-medium" title={variable.sample}>
                  {'{{'}{variable.key}{'}}'}
                </span>
              ))}
            </div>
          </section>
          <section className={PANEL_CLASS}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-medium"><HelpLabel help={t('email.templates.form.customVariables.help', 'User-defined accounting values, such as deadlines, tax amounts, or document links.')}>{t('email.templates.form.customVariables.label', 'Custom variables')}</HelpLabel></h2>
                <p className="max-w-full whitespace-normal break-words text-xs text-muted-foreground">{t('email.templates.form.customVariables.description', 'Define only values that come from accounting context, rules, or manual input. Sample values are preview-only.')}</p>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={addVariable}>{t('email.templates.form.addVariable', 'Add variable')}</Button>
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
                <div key={index} className="grid gap-2 rounded-md border border-border/60 p-2 md:grid-cols-[minmax(150px,1fr)_140px_minmax(180px,1fr)_auto] md:border-0 md:p-0">
                  <label className="grid gap-1 text-xs font-medium text-muted-foreground md:block"><span className="md:hidden">{t('email.templates.form.variableKey.label', 'Variable key')}</span><Input aria-label={t('email.templates.form.variableKey.label', 'Variable key')} className="font-normal text-foreground" value={variableName} onChange={(event) => updateVariableName(index, event.target.value)} placeholder="uploadFolderUrl" /></label>
                  <label className="grid gap-1 text-xs font-medium text-muted-foreground md:block"><span className="md:hidden">{t('email.templates.form.variableType.label', 'Type')}</span><select aria-label={t('email.templates.form.variableType.label', 'Type')} className={`${FIELD_CLASS} font-normal text-foreground`} value={parsedVariableTypes[variableName] ?? 'text'} onChange={(event) => updateVariableType(variableName, event.target.value as VariableType)}>
                    {variableTypes.map((type) => <option key={type} value={type}>{variableTypeLabel(t, type)}</option>)}
                  </select></label>
                  <label className="grid gap-1 text-xs font-medium text-muted-foreground md:block"><span className="md:hidden">{t('email.templates.form.variableSample.label', 'Preview value')}</span><Input aria-label={t('email.templates.form.samplePreviewValue', 'Sample preview value')} className="font-normal text-foreground" value={String(parseDefaultValues(value.defaultValues)[variableName] ?? '')} onChange={(event) => updateVariableSample(variableName, event.target.value)} placeholder={(parsedVariableTypes[variableName] ?? 'text') === 'link' ? 'https://example.com/folder' : t('email.templates.form.samplePreviewValue', 'Sample preview value')} /></label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-9 w-9 shrink-0 px-0 text-destructive hover:text-destructive"
                    aria-label={t('email.common.remove', 'Remove')}
                    title={t('email.common.remove', 'Remove')}
                    onClick={() => removeVariable(index)}
                  >
                    ×
                  </Button>
                  <p className="md:col-span-4 text-xs text-muted-foreground">{variableTypeHelp(t, parsedVariableTypes[variableName] ?? 'text')}</p>
                </div>
              )) : (
                <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">{t('email.templates.form.noCustomVariables', 'No custom variables yet. Use system variables for company/contact data, or add accounting fields like quarterLabel and deadlineDate.')}</div>
              )}
            </div>
          </section>
          <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.subject.help', 'Email subject line. Insert variables to personalize it during compose.')}>{t('email.templates.form.subject.label', 'Subject')}</HelpLabel>
            <div className="mt-1 flex gap-2">
              <Input ref={subjectInputRef} className="min-w-0 flex-1" value={value.subject} onChange={(event) => setField('subject', event.target.value)} required />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
              <span className="text-muted-foreground">{t('email.templates.form.insertVariable', 'Insert variable')}:</span>
              {availableFields.map((field) => (
                <Button key={field} type="button" size="sm" variant="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => insertIntoSubject(field)}>
                  {'{{'}{field}{'}}'}
                </Button>
              ))}
            </div>
          </label>
          <label className="block text-sm font-medium"><HelpLabel help={t('email.templates.form.preheader.help', 'Short preview text some email clients show under the subject.')}>{t('email.templates.form.preheader.label', 'Preheader')}</HelpLabel><Input className="mt-1" value={value.preheader} onChange={(event) => setField('preheader', event.target.value)} /></label>

          <section className={PANEL_CLASS}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0"><h2 className="font-medium"><HelpLabel help={t('email.templates.form.blocks.help', 'Build the email body from reusable blocks. Rich text blocks allow selected-text typography.')}>{t('email.templates.form.blocks.label', 'Visual builder blocks')}</HelpLabel></h2><p className="max-w-full whitespace-normal break-words text-xs text-muted-foreground">{t('email.templates.form.blocks.description', 'Editable blocks are stored as template blocks; rich text blocks support selected-text typography.')}</p></div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => addBlock('heading', t('email.templates.form.newHeading', 'New heading'))}>{blockTypeLabels.heading}</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => addBlock('rich-text-html', `<p>${t('email.templates.form.newRichText', 'New rich text')}</p>`)}>{blockTypeLabels['rich-text-html']}</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => addBlock('paragraph', t('email.templates.form.newParagraph', 'New paragraph'))}>{blockTypeLabels.paragraph}</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => addBlock('button', linkFallbackLabel, 'https://example.com/link')}>{blockTypeLabels.button}</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => addBlock('divider')}>{blockTypeLabels.divider}</Button>
              </div>
            </div>
            {value.blocks.map((block, index) => (
              <div key={block.id} className="min-w-0 space-y-2 rounded-md border border-border p-3">
                <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)_auto]">
                  <select className={FIELD_CLASS} value={block.type} onChange={(event) => updateBlock(index, { type: event.target.value as BlockType })}>
                    {(Object.keys(blockTypeLabels) as BlockType[]).map((type) => <option key={type} value={type}>{blockTypeLabels[type]}</option>)}
                  </select>
                  <Input value={block.label} onChange={(event) => updateBlock(index, { label: event.target.value })} placeholder={t('email.templates.form.blockLabel', 'Block label')} />
                  <div className="flex flex-wrap gap-1"><Button type="button" size="sm" variant="ghost" aria-label={t('email.templates.blocks.moveUp', 'Move up')} onClick={() => moveBlock(index, -1)}>↑</Button><Button type="button" size="sm" variant="ghost" aria-label={t('email.templates.blocks.moveDown', 'Move down')} onClick={() => moveBlock(index, 1)}>↓</Button><Button type="button" size="sm" variant="ghost" onClick={() => removeBlock(index)}>{t('email.common.remove', 'Remove')}</Button></div>
                </div>
                {block.type !== 'divider' ? (
                  <div className="space-y-2">
                    {block.type === 'rich-text-html' ? (
                      <>
                        <p className="text-xs text-muted-foreground">{t('email.templates.form.richTextHint', 'Select part of the email body, then use the toolbar for headings, size, color, bold, lists, alignment, links, and other typography.')}</p>
                        <RichEditor value={block.content} onChange={(content) => updateBlock(index, { content })} variant="full" minRows={8} placeholder={t('email.templates.form.bodyPlaceholder', 'Write your email body here. Use {{variables}} in content.')} />
                      </>
                    ) : (
                      <Textarea ref={(element) => { blockInputRefs.current[block.id] = element }} className="min-h-24" value={block.content} onChange={(event) => updateBlock(index, { content: event.target.value })} placeholder={t('email.templates.form.variableContentPlaceholder', 'Use {{variables}} in content')} />
                    )}
                    <div className="flex flex-wrap items-center gap-1 text-xs">
                      <span className="text-muted-foreground">{t('email.templates.form.insertVariable', 'Insert variable')}:</span>
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
                {block.type === 'button' ? <Input value={block.url} onChange={(event) => updateBlock(index, { url: event.target.value })} placeholder="https://example.com/link" /> : null}
              </div>
            ))}
          </section>

          <input type="hidden" value={value.fields} readOnly />
          <input type="hidden" value={value.sortOrder} readOnly />
          <input type="hidden" value={value.workflowKey} readOnly />
          <label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={value.isActive && canShowInGenerator} disabled={!canShowInGenerator} onCheckedChange={(checked) => setField('isActive', checked === true)} /> <HelpLabel help={t('email.templates.form.showInGenerator.help', 'Only published templates can appear in Compose Email. Draft and archived templates are hidden even when this is checked.')}>{t('email.templates.form.showInGenerator.label', 'Show in accounting generator')}</HelpLabel></label>
          <div className="sticky bottom-0 z-10 -mx-4 flex justify-between gap-2 border-t bg-surface/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
            {mode === 'edit' && onDelete ? <Button type="button" variant="destructive" disabled={isSaving} onClick={onDelete}>{t('email.common.delete', 'Delete')}</Button> : <span />}
            <div className="flex gap-2"><Button type="button" variant="soft" asChild><Link href="/backend/email/templates">{t('email.common.cancel', 'Cancel')}</Link></Button><Button type="submit" disabled={isSaving}>{isSaving ? t('email.common.saving', 'Saving…') : mode === 'create' ? t('email.templates.form.createSubmit', 'Create Template') : t('email.templates.form.saveSubmit', 'Save Template')}</Button></div>
          </div>
        </div>
        <aside className="w-full max-w-full min-w-0 space-y-4 self-start rounded-lg border bg-surface p-4 xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:overflow-auto">
          <div><h2 className="font-semibold"><HelpLabel help={t('email.templates.preview.help', 'Shows how the subject and body will look using sample values. Use Compose Email later to choose a specific company.')}>{t('email.templates.preview.title', 'Live preview')}</HelpLabel></h2><p className="text-sm text-muted-foreground">{t('email.templates.preview.description', 'Preview uses sample/default values only and does not send email.')}</p></div>
          {previewError ? <ErrorMessage label={previewError} /> : null}
          <div className={SUBPANEL_CLASS}>
            <div className="flex items-center justify-between gap-2"><div className="text-xs uppercase text-muted-foreground">{t('email.templates.form.subject.label', 'Subject')}</div><Button type="button" size="sm" variant="ghost" onClick={copyPreviewSubject}>{copied === 'subject' ? t('email.common.copied', 'Copied') : t('email.templates.preview.copySubject', 'Copy subject')}</Button></div>
            <div className="mt-1 break-words font-medium">{previewSubject}</div>{value.preheader ? <div className="mt-1 break-words text-sm text-muted-foreground">{renderWithSamples(value.preheader, sampleValues)}</div> : null}
          </div>
          <div className={SUBPANEL_CLASS}>
            <div className="flex items-center justify-between gap-2"><div className="text-xs uppercase text-muted-foreground">{t('email.templates.preview.emailBody', 'Email body')}</div><Button type="button" size="sm" variant="ghost" onClick={copyPreviewBody}>{copied === 'body' ? t('email.common.copied', 'Copied') : t('email.templates.preview.copyBody', 'Copy body')}</Button></div>
            <iframe className={PREVIEW_FRAME_CLASS} sandbox="" srcDoc={previewDocument(previewHtml)} title={t('email.templates.preview.iframeTitle', 'Email template preview')} />
          </div>
        </aside>
      </form>
    </>
  )
}
