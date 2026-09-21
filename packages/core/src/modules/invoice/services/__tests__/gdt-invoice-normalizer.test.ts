import {
  buildGdtSourceInvoiceId,
  MalformedGdtInvoiceError,
  normalizeGdtInvoice,
} from '../gdt/invoice-normalizer'

const base = {
  sellerMst: '0100109106',
  sellerName: 'Seller',
  buyerMst: '0101234567',
  buyerName: 'Buyer',
  templateCode: '01GTKT0',
  series: 'AA/26E',
  number: '123',
  invoiceDate: '2026-09-01',
  grossAmount: '1100',
  netAmount: '1000',
  vatAmount: '100',
}

describe('GDT invoice normalization', () => {
  it('maps sold records to AR and generates a stable source identity', () => {
    const result = normalizeGdtInvoice('sold', base)

    expect(result.direction).toBe('AR')
    expect(result.sourceInvoiceId).toBe('gdt:0100109106:01GTKT0:AA/26E:123')
    expect(result.invoiceDate.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('maps purchased records to AP and accepts legacy aliases', () => {
    const result = normalizeGdtInvoice('purchased', {
      seller_tax_code: base.sellerMst,
      seller_name: base.sellerName,
      buyer_tax_code: base.buyerMst,
      buyer_name: base.buyerName,
      template_code: base.templateCode,
      invoice_series: base.series,
      invoice_number: base.number,
      invoice_date: base.invoiceDate,
      total_amount: base.grossAmount,
    })

    expect(result.direction).toBe('AP')
    expect(buildGdtSourceInvoiceId(base)).toContain(':123')
  })

  it('normalizes source lines and rejects malformed rows', () => {
    const result = normalizeGdtInvoice('sold', {
      ...base,
      lines: [{ name: 'Item', quantity: '2', unitPrice: '500', lineTotal: '1000' }],
    })
    expect(result.lines?.[0]).toEqual(expect.objectContaining({ lineNumber: 1, lineTotal: '1000' }))

    expect(() => normalizeGdtInvoice('sold', { ...base, grossAmount: 'bad' })).toThrow(MalformedGdtInvoiceError)
  })
})
