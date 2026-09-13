/** @jest-environment node */

import { z } from 'zod'
import {
  currencyCodeSchema,
  emailSchema,
  moneyAmountSchema,
  moneyDecimalStringSchema,
  paginationQuerySchema,
} from '..'

/**
 * These pin the shared schemas against the hand-written ones they replaced, so
 * adoption cannot quietly change what a route accepts. If one of these fails,
 * the shared schema drifted — not the call site.
 */
describe('emailSchema matches the schema it replaced', () => {
  const previous = z.string().trim().email().max(320)
  const shared = emailSchema()
  const cases = [
    'user@example.com',
    '  spaced@example.com  ',
    'no-at-sign',
    '',
    `${'a'.repeat(310)}@example.com`,
    `${'a'.repeat(320)}@example.com`,
  ]

  it.each(cases)('agrees on %j', (input) => {
    const a = previous.safeParse(input)
    const b = shared.safeParse(input)
    expect(b.success).toBe(a.success)
    if (a.success && b.success) expect(b.data).toBe(a.data)
  })
})

describe('currencyCodeSchema', () => {
  const normalizing = currencyCodeSchema()
  const strict = currencyCodeSchema({ normalizeCase: false })

  it('accepts a well-formed code', () => {
    expect(normalizing.parse('USD')).toBe('USD')
  })

  it('normalizes case by default, matching currencies/checkout/warranty_claims', () => {
    expect(normalizing.parse('usd')).toBe('USD')
    expect(normalizing.parse('  eur ')).toBe('EUR')
  })

  it('rejects lower case when normalizeCase is off, matching catalog/sales', () => {
    expect(strict.safeParse('usd').success).toBe(false)
    expect(strict.parse('EUR')).toBe('EUR')
  })

  it('rejects the shapes the loosest previous variant let through', () => {
    // payment_gateways used z.string().min(3).max(3), which accepted these.
    for (const bad of ['ab1', '123', 'US', 'USDD', '$$$']) {
      expect(normalizing.safeParse(bad).success).toBe(false)
    }
  })
})

describe('paginationQuerySchema', () => {
  const schema = paginationQuerySchema()

  it('defaults to page 1 and the documented page size', () => {
    expect(schema.parse({})).toEqual({ page: 1, pageSize: 50 })
  })

  it('coerces query-string values', () => {
    expect(schema.parse({ page: '3', pageSize: '25' })).toEqual({ page: 3, pageSize: 25 })
  })

  it('rejects a fractional page, unlike z.coerce.number().min(1)', () => {
    expect(schema.safeParse({ page: '1.5' }).success).toBe(false)
  })

  it('caps pageSize at the documented maximum', () => {
    expect(schema.safeParse({ pageSize: '100' }).success).toBe(true)
    expect(schema.safeParse({ pageSize: '101' }).success).toBe(false)
  })

  it('lets a route raise the ceiling deliberately', () => {
    expect(paginationQuerySchema({ maxPageSize: 200 }).safeParse({ pageSize: '200' }).success).toBe(true)
  })
})

describe('moneyAmountSchema matches the rules it replaces', () => {
  it('reproduces warranty_claims positiveDecimal()', () => {
    const previous = z.coerce.number().positive().max(999_999_999)
    const shared = moneyAmountSchema({ positive: true })
    for (const input of [10, '10', 0, -1, 999_999_999, 1_000_000_000, 10.005]) {
      expect(shared.safeParse(input).success).toBe(previous.safeParse(input).success)
    }
  })

  it('reproduces warranty_claims nullableDecimal() bounds', () => {
    const previous = z.coerce.number().min(0).max(999_999_999)
    const shared = moneyAmountSchema()
    for (const input of [0, 10, -0.01, 999_999_999, 1e10]) {
      expect(shared.safeParse(input).success).toBe(previous.safeParse(input).success)
    }
  })

  it('bounds an amount that previously had no ceiling', () => {
    // payment_gateways used z.number().positive(), which accepted 1e21 —
    // Math.round(1e21 * 100) is not a representable minor-unit value.
    expect(z.number().positive().safeParse(1e21).success).toBe(true)
    expect(moneyAmountSchema({ positive: true }).safeParse(1e21).success).toBe(false)
  })

  describe('scale guard', () => {
    const schema = moneyAmountSchema({ positive: true, scale: 2 })

    it.each([10, 10.5, 10.55, '10.55'])('accepts %j', (input) => {
      expect(schema.safeParse(input).success).toBe(true)
    })

    it.each([10.005, 0.001, 10.555])('rejects %j, which Math.round(x*100) would silently move', (input) => {
      expect(schema.safeParse(input).success).toBe(false)
    })

    it('is off by default so callers opt in deliberately', () => {
      expect(moneyAmountSchema({ positive: true }).safeParse(0.001).success).toBe(true)
    })
  })
})

describe('moneyAmountSchema coercion', () => {
  /**
   * The default is `z.coerce.number()`, which every query-string and form
   * adopter needs. That also means `Number(true) === 1`, so a call site that
   * replaced a `z.number()` JSON-body field must pass `coerce: false` — the
   * payment-session amount does. These pin both halves of that contract.
   */
  it('coerces numeric strings by default, matching the z.coerce.number() adopters', () => {
    expect(moneyAmountSchema({ positive: true }).safeParse('10').success).toBe(true)
  })

  it.each([[true], [['10']], [[]], [null], ['10'], [{}], ['abc']])(
    'rejects the non-number %j when coerce is off, matching the z.number() adopters',
    (input) => {
      expect(moneyAmountSchema({ positive: true, coerce: false }).safeParse(input).success).toBe(false)
    },
  )

  it('accepts a real number when coerce is off', () => {
    expect(moneyAmountSchema({ positive: true, coerce: false }).safeParse(10.5).success).toBe(true)
  })

  it('reproduces the z.number().positive() the payment session used to declare', () => {
    const previous = z.number().positive()
    const shared = moneyAmountSchema({ positive: true, coerce: false, max: null })
    for (const input of [10, 10.5, 0, -1, true, '10', null, [], {}]) {
      expect(shared.safeParse(input).success).toBe(previous.safeParse(input).success)
    }
  })
})

describe('moneyDecimalStringSchema matches invoice money schemas', () => {
  it('reproduces invoiceMoneySchema (signed, 14.4)', () => {
    const previous = z.string().trim().regex(/^-?\d{1,14}(\.\d{1,4})?$/)
    const shared = moneyDecimalStringSchema({ signed: true })
    for (const input of ['1', '-1', '1.0001', '1.00001', '', 'abc', '12345678901234', '123456789012345']) {
      expect(shared.safeParse(input).success).toBe(previous.safeParse(input).success)
    }
  })

  it('reproduces invoicePositiveMoneySchema (unsigned)', () => {
    const previous = z.string().trim().regex(/^\d{1,14}(\.\d{1,4})?$/)
    const shared = moneyDecimalStringSchema()
    for (const input of ['1', '-1', '1.0001', '1.00001']) {
      expect(shared.safeParse(input).success).toBe(previous.safeParse(input).success)
    }
  })
})
