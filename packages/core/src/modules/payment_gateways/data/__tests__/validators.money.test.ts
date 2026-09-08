/** @jest-environment node */

import { createSessionSchema } from '../validators'

const base = { providerKey: 'mock', amount: 10 }

function parseCurrency(currencyCode: unknown) {
  return createSessionSchema.safeParse({ ...base, currencyCode })
}

describe('createSessionSchema currencyCode', () => {
  it('accepts a well-formed ISO 4217 code', () => {
    const result = parseCurrency('USD')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.currencyCode).toBe('USD')
  })

  it.each([
    [' eur ', 'EUR'],
    ['usd', 'USD'],
    ['Gbp', 'GBP'],
  ])('trims and upper-cases %j to %j, matching the service comparison', (input, expected) => {
    const result = parseCurrency(input)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.currencyCode).toBe(expected)
  })

  // TC-PGWY-017 asserts 422 for both of these; keep that contract.
  it.each(['US', 'USDA'])('still rejects %j, which is not three characters', (input) => {
    expect(parseCurrency(input).success).toBe(false)
  })

  // The previous `.min(3).max(3)` let all of these through to the transaction
  // row and the payment provider.
  it.each(['ab1', '123', '$$$', 'u s', 'US1'])('rejects %j, which is not a currency code', (input) => {
    expect(parseCurrency(input).success).toBe(false)
  })

  it('still requires the field', () => {
    expect(createSessionSchema.safeParse(base).success).toBe(false)
  })
})

describe('createSessionSchema amount', () => {
  function parseAmount(amount: unknown) {
    return createSessionSchema.safeParse({ providerKey: 'mock', currencyCode: 'USD', amount })
  }

  it.each([10, 10.5, 10.55])('accepts %j', (input) => {
    expect(parseAmount(input).success).toBe(true)
  })

  // toCents() is Math.round(amount * 100): 0.001 charged 0, 10.005 charged 10.01.
  it.each([0.001, 10.005, 10.555])('rejects %j rather than silently rounding it at the gateway', (input) => {
    expect(parseAmount(input).success).toBe(false)
  })

  it('rejects an unbounded amount', () => {
    expect(parseAmount(1e21).success).toBe(false)
  })

  it('still rejects zero and negatives', () => {
    expect(parseAmount(0).success).toBe(false)
    expect(parseAmount(-1).success).toBe(false)
  })

  /**
   * The field was `z.number().positive()` before the shared schema was adopted.
   * `moneyAmountSchema` coerces by default, and `Number(true)` is `1` — which
   * would turn a malformed body into a one-unit charge. `coerce: false` at the
   * call site keeps the original strictness.
   */
  it.each([[true], [false], [['10']], [[]], [null], ['10'], ['abc'], [{}]])(
    'rejects the non-number %j instead of coercing it',
    (input) => {
      expect(parseAmount(input).success).toBe(false)
    },
  )
})
