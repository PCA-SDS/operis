/**
 * PCA ERP form chrome — the shared look for every create/edit form surface.
 *
 * Measured from the PCA reference (`~/Documents/Github/pca_erp`), which applies
 * the same three rules across `NewProspectPage`, `PCACreateCompanyPage` and
 * `CreateUserDialog`:
 *
 * - **The section is borderless.** A filled `surface-muted` panel with a soft
 *   shadow carries the grouping; there is no outline. `PCACreateCompanyPage`
 *   inverts the fill to `surface` on a muted page, but never adds a border.
 * - **The section title sits ABOVE the panel**, at page-heading size, so a form
 *   reads as a stack of named blocks rather than as cards with captions inside.
 * - **The field label is a micro-label**: small, bold, uppercase, muted. It is
 *   the only uppercase text in the form — section titles stay sentence case.
 *
 * Controls inside the panel drop their border and take the opposite fill, so a
 * field reads as a white tile on the grey panel. That is done in one CSS rule
 * keyed off `FORM_SECTION_ATTR` rather than per control, because a section can
 * hold any control family (Input, Select trigger, Textarea, phone field,
 * combobox, or a module's own widget) and those must not disagree.
 */

/** Wrapper around a titled section: header above, panel below. */
export const FORM_SECTION = 'space-y-3'

/** The section's heading block, above the panel. */
export const FORM_SECTION_HEADER = 'py-1'

/** Section title. Sentence case — the uppercase in a form belongs to labels. */
export const FORM_SECTION_TITLE = 'text-2xl font-semibold text-foreground'

/** Optional supporting copy under the section title. */
export const FORM_SECTION_DESCRIPTION = 'mt-1 text-sm text-muted-foreground'

/** The filled, borderless panel holding a section's fields. */
export const FORM_SECTION_PANEL =
  'space-y-5 rounded-xl bg-surface-muted px-5 py-6 shadow-sm sm:px-6'

/**
 * Marks a panel so the one stylesheet rule can strip borders from whatever
 * controls it contains. Spread onto the panel element.
 */
export const FORM_SECTION_ATTR = { 'data-crud-section': 'true' } as const

/** Field label: the form's only uppercase text. */
export const FORM_FIELD_LABEL =
  'mb-2.5 block text-xs font-bold uppercase tracking-wide text-muted-foreground'

/** The required marker appended to a label. */
export const FORM_FIELD_REQUIRED_MARK = 'ml-1 text-destructive'

/**
 * Secondary hint shown inline after a label. Opts back out of the label's
 * uppercase so the hint stays readable.
 */
export const FORM_FIELD_HINT =
  'ml-1.5 font-medium normal-case tracking-normal text-disabled-foreground'
