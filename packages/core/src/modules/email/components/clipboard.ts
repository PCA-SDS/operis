"use client"

type ClipboardItemConstructor = new (items: Record<string, Blob>) => ClipboardItem

/**
 * HTML → plain text for the clipboard's `text/plain` flavour.
 *
 * Parsing into an inert `<template>` (no scripts run, no resources load) is what
 * turns `&amp;` back into `&`. The builder preview shipped a regex-only variant
 * that left entities encoded, so copying the same body from the builder and
 * from compose produced different text.
 */
export function htmlToPlainText(html: string): string {
  const blockBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
  if (typeof document === 'undefined') {
    return blockBreaks.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim()
  }
  // A detached <template> parses inertly by specification: its content lives in
  // a separate document fragment, so no script runs and no resource loads. The
  // result is only ever read back as text, never re-attached to the document.
  const element = document.createElement('template')
  element.innerHTML = blockBreaks
  return (element.content.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

export async function copyText(value: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  await navigator.clipboard.writeText(value)
}

/** Copies both flavours so pasting into an email client keeps the formatting. */
export async function copyHtml(html: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  const plainText = htmlToPlainText(html)
  const ClipboardItemCtor = (globalThis as { ClipboardItem?: ClipboardItemConstructor }).ClipboardItem

  if (navigator.clipboard.write && ClipboardItemCtor) {
    await navigator.clipboard.write([
      new ClipboardItemCtor({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      }),
    ])
    return
  }

  await navigator.clipboard.writeText(plainText)
}
