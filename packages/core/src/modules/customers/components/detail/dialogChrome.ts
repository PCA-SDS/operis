import { DIALOG_BODY_CLASS } from '@open-mercato/ui/primitives/dialog'

/**
 * Fixed dialog bodies for the customer detail pages, matching the calendar event
 * editor: the body has a FIXED height and scrolls inside, so a notice, an error
 * summary or a field appearing never resizes the dialog or moves its footer.
 * The insets are `DialogBody`'s own, so a form body lines up with the header
 * above and hands the gap above the buttons to the footer below.
 */
export const DETAIL_DIALOG_BODY = `h-[min(70vh,40rem)] min-h-0 overflow-y-auto ${DIALOG_BODY_CLASS}`

/** The same fixed body for dialogs holding only a few fields. */
export const DETAIL_DIALOG_BODY_COMPACT = `h-[min(60vh,26rem)] min-h-0 overflow-y-auto ${DIALOG_BODY_CLASS}`
