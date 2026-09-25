/**
 * Fixed dialog bodies for the customer detail pages, matching the calendar event
 * editor: the body has a FIXED height and scrolls inside, so a notice, an error
 * summary or a field appearing never resizes the dialog or moves its footer.
 * The padding is `DialogBody`'s, so a form body lines up with the header above.
 */
export const DETAIL_DIALOG_BODY = 'h-[min(70vh,40rem)] min-h-0 overflow-y-auto px-5 pt-3 pb-5 sm:px-6'

/** The same fixed body for dialogs holding only a few fields. */
export const DETAIL_DIALOG_BODY_COMPACT = 'h-[min(60vh,26rem)] min-h-0 overflow-y-auto px-5 pt-3 pb-5 sm:px-6'
