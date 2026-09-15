export type PreviewLine = {
  quantity: string
  unitPrice: string
  discountAmount?: string | null
  discountPercent?: string | number | null
  vatRate?: string | number | null
}

const round = (value: number) => Number(value.toFixed(4))

export function lineTotals(line: PreviewLine) {
  const base = round(round(Number(line.quantity || 0)) * round(Number(line.unitPrice || 0)))
  const discount = round(line.discountPercent != null ? base * Number(line.discountPercent) / 100 : Number(line.discountAmount || 0))
  const subtotal = round(base - discount)
  const vat = round(subtotal * Number(line.vatRate || 0) / 100)
  return { subtotal, vat, total: round(subtotal + vat) }
}

export function invoiceTotals(lines: PreviewLine[]) {
  return lines.reduce((sum, line) => {
    const amount = lineTotals(line)
    return { subtotal: round(sum.subtotal + amount.subtotal), vat: round(sum.vat + amount.vat), total: round(sum.total + amount.total) }
  }, { subtotal: 0, vat: 0, total: 0 })
}
