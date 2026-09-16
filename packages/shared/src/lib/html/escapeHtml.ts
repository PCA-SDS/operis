/**
 * Escape a string for interpolation into HTML text or a quoted attribute.
 *
 * Both the email template renderer and the checkout email worker build HTML by
 * concatenation, and each shipped its own byte-identical copy of this. One copy
 * means one place to audit when the escaping set changes.
 *
 * This is NOT a sanitiser: it escapes a value that must appear as literal text.
 * Markup that is meant to survive belongs in `sanitizeRichTextHtml`.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
