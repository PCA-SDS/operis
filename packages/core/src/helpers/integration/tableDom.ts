import type { Locator, Page } from '@playwright/test'

/**
 * Locators for the DataTable DOM.
 *
 * `Table` is a CSS grid, not an HTML `<table>`: rows and cells are `div`s
 * carrying `role` and `data-slot` hooks (see `packages/ui/src/primitives/table.tsx`).
 * Native `tbody tr` / `thead th` selectors therefore match nothing, and a spec
 * that uses them fails as "0 rows" rather than as a broken selector — which is
 * how a whole family of specs went quiet after the grid rebuild.
 *
 * Every spec reads the table through this module so the contract lives in one
 * place: if the slot names change again, this file changes and the specs do not.
 */

export const TABLE_HEADER_SELECTOR = '[data-slot="table-header"]'
export const TABLE_BODY_SELECTOR = '[data-slot="table-body"]'
export const TABLE_FOOTER_SELECTOR = '[data-slot="table-footer"]'
export const TABLE_ROW_SELECTOR = '[data-slot="table-row"]'
export const TABLE_HEAD_SELECTOR = '[data-slot="table-head"]'
export const TABLE_CELL_SELECTOR = '[data-slot="table-cell"]'

/** The body's data rows — the grid equivalent of `tbody tr`. */
export function tableRows(scope: Page | Locator): Locator {
  return scope.locator(`${TABLE_BODY_SELECTOR} ${TABLE_ROW_SELECTOR}`)
}

/** The body rowgroup — the grid equivalent of `tbody`. */
export function tableBody(scope: Page | Locator): Locator {
  return scope.locator(TABLE_BODY_SELECTOR)
}

/** The header rowgroup — the grid equivalent of `thead`. */
export function tableHeader(scope: Page | Locator): Locator {
  return scope.locator(TABLE_HEADER_SELECTOR)
}

/** Header cells — the grid equivalent of `thead th`. */
export function tableHeadCells(scope: Page | Locator): Locator {
  return scope.locator(`${TABLE_HEADER_SELECTOR} ${TABLE_HEAD_SELECTOR}`)
}

/**
 * The sortable header button for a column, by its visible label.
 * Replaces `page.locator('thead button', { hasText: label })`.
 */
export function tableHeaderButton(scope: Page | Locator, label: string): Locator {
  return scope.locator(`${TABLE_HEADER_SELECTOR} button`).filter({ hasText: label }).first()
}

/** A body row containing the given text — replaces `page.locator('tr').filter(...)`. */
export function tableRowByText(scope: Page | Locator, text: string): Locator {
  return tableRows(scope).filter({ hasText: text }).first()
}

/** The header's select-all checkbox. */
export function tableSelectAllCheckbox(scope: Page | Locator): Locator {
  return tableHeader(scope).getByRole('checkbox')
}

/** Cells of a row — the grid equivalent of `tr td`. */
export function tableCells(row: Locator): Locator {
  return row.locator(TABLE_CELL_SELECTOR)
}
