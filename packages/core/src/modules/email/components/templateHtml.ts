import { sanitizeRichTextHtml } from '@open-mercato/shared/lib/html/sanitizeRichText'
import { escapeHtml } from '@open-mercato/shared/lib/html/escapeHtml'

/**
 * Pure template rendering and parsing.
 *
 * These used to live inside `TemplateBuilderForm`, which forced the compose
 * page to import a `'use client'` component just to reach them and let the two
 * readers of the persisted shape drift apart. Keeping them here — with no React
 * and no browser globals — means the builder preview, the compose preview and
 * any future server-side renderer all resolve a template the same way.
 */

export type TemplateStatus = 'draft' | 'published' | 'archived'
export type BlockType = 'heading' | 'paragraph' | 'button' | 'divider' | 'rich-text-html'
export type VariableType = 'text' | 'link' | 'date' | 'number' | 'money' | 'email'

export type TemplateBlockFormValue = {
  id: string
  type: BlockType
  label: string
  content: string
  url: string
}

/** Placeholders the compose page fills from the selected company and its people. */
export const systemVariables = [
  { key: 'companyName', sample: 'Harborview Analytics' },
  { key: 'companyCode', sample: 'HV-001' },
  { key: 'companyEmail', sample: 'info@harborviewanalytics.com' },
  { key: 'contactNames', sample: 'Ms. Linh, Mr. David' },
  { key: 'recipientEmails', sample: 'linh@example.com, david@example.com' },
  { key: 'greeting', sample: 'Dear Ms. Linh,\nDear Mr. David,' },
] as const

export const variableTypes: VariableType[] = ['text', 'link', 'date', 'number', 'money', 'email']

const systemVariableKeys: ReadonlySet<string> = new Set(systemVariables.map((variable) => variable.key))

const VARIABLE_TOKEN = /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g

export function splitCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

export function customTemplateVariables(value: string): string[] {
  return splitCsv(value).filter((variable) => !systemVariableKeys.has(variable))
}

export function customTemplateValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(values)
    .filter(([key]) => !systemVariableKeys.has(key))
    .map(([key, value]) => [key, String(value)]))
}

export function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value || '{}') as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`[internal] ${label} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

export function createStaticBlock(id: string, type: BlockType, content = '', url = '', label?: string): TemplateBlockFormValue {
  return { id, type, label: label ?? type, content, url }
}

export function createBlock(type: BlockType, content = '', url = '', label?: string): TemplateBlockFormValue {
  return createStaticBlock(`block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, content, url, label)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** jsonb columns arrive parsed, but a stringified column would silently read as "no blocks". */
function parseStoredJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function toBlockType(value: unknown): BlockType {
  // `rich_text` is the legacy spelling of `rich-text-html`. Resolving it here
  // rather than per-reader is the point: one reader mapped it to rich text and
  // the other to a paragraph, so the same stored template rendered its body as
  // HTML in compose and as escaped source in the builder.
  if (value === 'rich_text') return 'rich-text-html'
  if (value === 'heading' || value === 'button' || value === 'divider' || value === 'rich-text-html') return value
  return 'paragraph'
}

/**
 * The single reader of a persisted template body.
 *
 * `blocks` is authoritative; `design.body.html` is the pre-builder shape that
 * migrated rows still carry. Returns an empty list when the record holds no
 * body at all, so callers decide whether that means "seed an empty block" or
 * "render nothing".
 */
export function blocksFromRecord(blocks: unknown, design: unknown): TemplateBlockFormValue[] {
  const storedBlocks = parseStoredJson(blocks)
  if (Array.isArray(storedBlocks) && storedBlocks.length > 0) {
    return storedBlocks.map((item, index) => {
      const record = isRecord(item) ? item : {}
      const props = isRecord(record.props) ? record.props : {}
      const type = toBlockType(record.type)
      return {
        id: typeof record.id === 'string' && record.id ? record.id : `block-${index + 1}`,
        type,
        label: typeof record.label === 'string' && record.label ? record.label : type,
        content: typeof props.html === 'string' ? props.html : typeof props.text === 'string' ? props.text : '',
        url: typeof props.href === 'string' ? props.href : '',
      }
    })
  }
  const storedDesign = parseStoredJson(design)
  if (isRecord(storedDesign) && isRecord(storedDesign.body) && typeof storedDesign.body.html === 'string' && storedDesign.body.html) {
    return [createStaticBlock('design-body', 'rich-text-html', storedDesign.body.html)]
  }
  return []
}

export function sanitizeHref(value: string): string {
  return /^https?:\/\//i.test(value) ? value : '#'
}

export function blocksToHtml(blocks: TemplateBlockFormValue[], linkFallbackLabel = 'Open link'): string {
  return blocks.map((block) => {
    if (block.type === 'heading') return `<h2>${escapeHtml(block.content)}</h2>`
    if (block.type === 'button') return `<p><a href="${escapeHtml(sanitizeHref(block.url || '#'))}">${escapeHtml(block.content || linkFallbackLabel)}</a></p>`
    if (block.type === 'divider') return '<hr />'
    // Every sibling branch escapes; this one shipped the stored body raw, so a
    // tenant-authored template reached the preview and the clipboard unfiltered.
    if (block.type === 'rich-text-html') return sanitizeRichTextHtml(block.content)
    return `<p>${escapeHtml(block.content).replace(/\n/g, '<br />')}</p>`
  }).join('\n')
}

export function renderWithSamples(value: string, samples: Record<string, unknown>): string {
  return value.replace(VARIABLE_TOKEN, (_match, key: string) => String(samples[key] ?? `{{${key}}}`))
}

export function renderHtmlPreviewWithSamples(value: string, samples: Record<string, unknown>, types: Record<string, VariableType>): string {
  return value.replace(VARIABLE_TOKEN, (_match, key: string, offset: number, source: string) => {
    const sample = String(samples[key] ?? `{{${key}}}`)
    const before = source.slice(Math.max(0, offset - 120), offset).toLowerCase()
    const after = source.slice(offset, offset + 120).toLowerCase()
    const alreadyInsideAnchor = before.lastIndexOf('<a ') > before.lastIndexOf('</a>') && after.includes('</a>')
    const isLink = types[key] === 'link' || /(?:url|link)$/i.test(key) || /^https?:\/\//i.test(sample)
    // Inside an existing anchor the value IS the href — the shipped templates are
    // all <a href="{{uploadLink}}"> — so it still needs the scheme check.
    if (alreadyInsideAnchor) return escapeHtml(isLink ? sanitizeHref(sample) : sample)
    if (!isLink) return escapeHtml(sample).replace(/\n/g, '<br />')
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

export { escapeHtml }
