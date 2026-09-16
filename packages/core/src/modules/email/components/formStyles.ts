/**
 * Shared class strings for the email module's hand-built forms.
 *
 * The five pages each carried their own spelling of "a field", "a panel" and
 * "the preview frame" — several painted with `bg-background`, the page ground,
 * which rendered a grey block on a white card. Declaring them once is what
 * keeps the builder, compose and accounting-defaults looking like one product.
 *
 * Native `<select>` has no design-system primitive: `Select` is Radix-based and
 * rejects the empty-string option values these "Any / none" filters rely on, so
 * the element stays native and borrows the `Input` primitive's field treatment.
 */
export const FIELD_CLASS =
  'h-9 w-full rounded-lg border border-input bg-input-bg px-3 text-sm font-medium transition-colors hover:bg-modal-muted focus:border-input-border-focus focus:shadow-focus focus:outline-none'

/** A quiet fill inside a `bg-surface` card — elevation step 2. */
export const PANEL_CLASS = 'min-w-0 space-y-3 rounded-md border border-border bg-surface-muted p-3'

export const SUBPANEL_CLASS = 'min-w-0 rounded-md border border-border bg-surface-muted p-3'

export const PREVIEW_FRAME_CLASS = 'mt-2 h-[min(24rem,70vh)] min-h-64 w-full rounded border'

/**
 * The document both previews render.
 *
 * `sandbox=""` keeps it fully inert. The white ground and the body type belong
 * to the *email*, not to the admin UI, so they are declared here rather than as
 * a `bg-white` class on the frame — the preview should look like the recipient's
 * client regardless of the operator's theme.
 */
export function previewDocument(bodyHtml: string): string {
  return `<!doctype html><html><body style="background:#FFFFFF;font-family:Arial,sans-serif;color:#111827;line-height:1.5;padding:16px;margin:0;max-width:100%;overflow-wrap:anywhere">${bodyHtml}</body></html>`
}
