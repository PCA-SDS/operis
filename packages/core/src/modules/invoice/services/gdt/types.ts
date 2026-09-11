export type GdtStream = 'sold' | 'purchased'

export type GdtWireRecord = Record<string, unknown>

export type GdtInvoicePage = {
  items: GdtWireRecord[]
  hasNext: boolean
}

export type GdtFetchWindow = {
  fromDate: string
  toDate: string
}
