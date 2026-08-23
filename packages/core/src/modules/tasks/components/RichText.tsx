"use client"

import * as React from 'react'
import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'
import { sanitizeRichTextHtml } from '@open-mercato/shared/lib/html/sanitizeRichText'
import { cn } from '@open-mercato/shared/lib/utils'
import { htmlToPlainText, trimRichText } from './richTextUtils'

export type RichTextValue = { html: string; text: string }

/**
 * The module's rich-text field. Wraps the DS editor and adds the plaintext
 * mirror the module stores alongside the HTML, so search and previews never
 * have to parse markup.
 *
 * The DS editor reports on blur, which is also when a task description should
 * save — a field-level PATCH per keystroke would be a write storm.
 */
export function RichTextEditor({
  value,
  onChange,
  onBlur,
  onSubmit,
  placeholder,
  minRows = 3,
  disabled,
  className,
  variant = 'basic',
}: {
  value: string
  onChange?: (next: RichTextValue) => void
  onBlur?: (next: RichTextValue) => void
  /** Enter (without Shift) commits the draft. Shift+Enter stays a newline. */
  onSubmit?: (next: RichTextValue) => void
  placeholder?: string
  minRows?: number
  disabled?: boolean
  className?: string
  variant?: 'standard' | 'basic' | 'minimal'
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  const handleChange = React.useCallback(
    (html: string) => {
      const next = trimRichText(html)
      onChange?.(next)
      onBlur?.(next)
    },
    [onChange, onBlur],
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!onSubmit || event.key !== 'Enter' || event.shiftKey) return
      event.preventDefault()
      // The editor only reports on blur, and Enter does not blur it — so the
      // draft in React state is a keystroke behind. Read the live content.
      const node = containerRef.current?.querySelector('[data-slot="rich-editor-content"]')
      const next = trimRichText(node instanceof HTMLElement ? node.innerHTML : value)
      onChange?.(next)
      onSubmit(next)
    },
    [onSubmit, onChange, value],
  )

  const editor = (
    <RichEditor
      value={value}
      onChange={handleChange}
      variant={variant}
      placeholder={placeholder}
      minRows={minRows}
      disabled={disabled}
      className={className}
    />
  )

  if (!onSubmit) return editor

  // `display: contents` keeps the wrapper out of layout while leaving it in the
  // event path, so adding a submit handler cannot reflow the field.
  return (
    <div ref={containerRef} onKeyDown={handleKeyDown} style={{ display: 'contents' }}>
      {editor}
    </div>
  )
}

/** Read-only rendering of stored rich text. The value was sanitised on write;
 *  sanitising again here keeps a row that predates a tightening safe. */
export function RichTextView({ html, className }: { html: string; className?: string }) {
  const safe = React.useMemo(() => sanitizeRichTextHtml(html), [html])
  if (!safe) return null
  return (
    <div
      className={cn('prose-tasks text-sm text-foreground [&_a]:text-accent-strong [&_a]:underline', className)}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  )
}

export { htmlToPlainText, trimRichText }
