/** @jest-environment node */

import {
  channelCreateSchema,
  orderAdjustmentCreateSchema,
  quoteAdjustmentCreateSchema,
} from '../validators'

/**
 * `decimal()` used to serve both money and non-money fields. It is now split, so
 * these pin the boundary: money carries the `numeric(18,4)` precision of its
 * column, while coordinates keep the `numeric(10,6)` precision of theirs.
 */
describe('sales money vs generic decimal', () => {
  const baseChannel = {
    name: 'Web',
    code: 'web',
    organizationId: '22222222-2222-4222-8222-222222222222',
    tenantId: '33333333-3333-4333-8333-333333333333',
  }

  it('keeps six-decimal precision on latitude/longitude', () => {
    const result = channelCreateSchema.safeParse({
      ...baseChannel,
      latitude: 52.229676,
      longitude: 21.012229,
    })
    expect(result.success).toBe(true)
  })

  it('accepts money at the column scale', () => {
    const result = orderAdjustmentCreateSchema.safeParse({
      orderId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      tenantId: '33333333-3333-4333-8333-333333333333',
      kind: 'discount',
      label: 'Promo',
      amountNet: -7.5,
      amountGross: -7.5,
    })
    expect(result.success).toBe(true)
  })

  it('keeps adjustment amounts signed', () => {
    const signed = quoteAdjustmentCreateSchema.safeParse({
      quoteId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      tenantId: '33333333-3333-4333-8333-333333333333',
      kind: 'discount',
      label: 'Promo',
      amountNet: -12.3456,
      amountGross: -12.3456,
    })
    expect(signed.success).toBe(true)
  })

  /**
   * Regression guard. A scale check here rejects the values the sales UI
   * actually sends: `LineItemDialog` derives net from gross as
   * `unitPrice / (1 + taxRate / 100)`, so a 100.00 gross line at 7% tax submits
   * 93.45794392523365. `numeric(18,4)` has always rounded these on write, and
   * making the schema reject them instead fails an ordinary line-item save.
   */
  it('accepts the unrounded quotients the line-item form submits', () => {
    const netFromGross = 100 / (1 + 7 / 100)
    expect(netFromGross.toString()).toContain('93.4579439252336')

    const result = orderAdjustmentCreateSchema.safeParse({
      orderId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      tenantId: '33333333-3333-4333-8333-333333333333',
      kind: 'discount',
      label: 'Promo',
      amountNet: netFromGross,
      amountGross: 100,
    })
    expect(result.success).toBe(true)
  })

  it('still rejects an amount beyond the column capacity', () => {
    const result = orderAdjustmentCreateSchema.safeParse({
      orderId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      tenantId: '33333333-3333-4333-8333-333333333333',
      kind: 'discount',
      label: 'Promo',
      amountNet: 99_999_999_999_999 + 1,
    })
    expect(result.success).toBe(false)
  })
})
