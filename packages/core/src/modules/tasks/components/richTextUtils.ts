"use client"

// Rich text helpers shared by the description editor, comments and doc pages.
// The DS `RichEditor` hands back sanitised HTML only, so the plaintext mirror
// the module stores (for search and previews) is derived here.

/** `\s` already covers U+00A0 and every line terminator. */
const BLANK_TEXT = /^\s*$/

export function htmlToPlainText(html: string): string {
  if (typeof document === 'undefined') {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim()
  }
  // A <template> parses inertly: no scripts run and no resources load, and the
  // result is only ever read back as text.
  const template = document.createElement('template')
  template.innerHTML = html
  return (template.content.textContent ?? '').trim()
}

function isBlankNode(node: ChildNode): boolean {
  if (node.nodeType === Node.TEXT_NODE) return BLANK_TEXT.test(node.textContent ?? '')
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element
    if (element.tagName === 'BR') return true
    // Media is never blank, even with no text — and the element itself counts,
    // not just its descendants, or a bare <img> would be trimmed away.
    if (element.matches('img,hr') || element.querySelector('img,hr')) return false
    return BLANK_TEXT.test(element.textContent ?? '')
  }
  return true
}

function trimEdgeChildren(element: Element): void {
  while (element.firstChild && isBlankNode(element.firstChild)) {
    element.removeChild(element.firstChild)
  }
  while (element.lastChild && isBlankNode(element.lastChild)) {
    element.removeChild(element.lastChild)
  }
  if (element.firstChild?.nodeType === Node.TEXT_NODE) {
    element.firstChild.textContent = (element.firstChild.textContent ?? '').replace(/^\s+/, '')
  }
  if (element.lastChild?.nodeType === Node.TEXT_NODE) {
    element.lastChild.textContent = (element.lastChild.textContent ?? '').replace(/\s+$/, '')
  }
}

/** Markup with no text can still carry meaning — an image or a rule is content,
 *  and discarding it as "empty" would lose the user's work. */
function hasMedia(html: string): boolean {
  if (typeof document === 'undefined') return /<(img|hr)\b/i.test(html)
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content.querySelector('img,hr') !== null
}

/**
 * Strip leading and trailing blank content — empty paragraphs, stray `<br>`,
 * whitespace — so a description or comment that looks empty is stored empty and
 * one with trailing blank lines is stored clean.
 */
export function trimRichText(html: string): { html: string; text: string } {
  const text = htmlToPlainText(html)
  if (text === '' && !hasMedia(html)) return { html: '', text: '' }
  if (typeof document === 'undefined') return { html: html.trim(), text }

  const template = document.createElement('template')
  template.innerHTML = html
  const root = template.content

  while (root.firstChild && isBlankNode(root.firstChild)) root.removeChild(root.firstChild)
  while (root.lastChild && isBlankNode(root.lastChild)) root.removeChild(root.lastChild)

  if (root.firstElementChild) trimEdgeChildren(root.firstElementChild)
  if (root.lastElementChild) trimEdgeChildren(root.lastElementChild)

  return { html: template.innerHTML.trim(), text }
}
