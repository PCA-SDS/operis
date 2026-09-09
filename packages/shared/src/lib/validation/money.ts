import { z } from 'zod'

/**
 * Upper bound for a monetary amount. Matches the ceiling `warranty_claims` and
 * `sales` already use, and keeps an amount inside the range where a JS number
 * still represents minor units exactly.
 */
export const MONEY_MAX_AMOUNT = 999_999_999

/** Minor-unit scale for the ordinary (two-decimal) currencies. */
export const MONEY_DEFAULT_SCALE = 2

/** Decimal places in a finite number, ignoring exponent notation. */
function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0
  const text = String(value)
  if (text.includes('e') || text.includes('E')) return Infinity
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

export type MoneyAmountSchemaOptions = {
  /** Smallest accepted value, inclusive. Defaults to `0`. */
  min?: number
  /**
   * Largest accepted value, inclusive. Defaults to {@link MONEY_MAX_AMOUNT}.
   *
   * Pass the column's own capacity when it is wider — sales totals live in
   * `numeric(18,4)`, and the generic ceiling would reject legitimate amounts in
   * high-denomination currencies (a billion VND is roughly forty thousand USD).
   * `null` disables the bound entirely; prefer a real number.
   */
  max?: number | null
  /** Reject zero as well as negatives. */
  positive?: boolean
  /**
   * Maximum decimal places. Omit to skip the check entirely — do that only for
   * a field that is not converted to minor units downstream.
   *
   * This is the part worth having. `z.number().positive()` accepts `0.001`, and
   * the gateway adapters convert with `Math.round(amount * 100)`, so a session
   * stored as `0.001` charges **zero** at the provider; `10.005` silently
   * becomes `10.01`. Neither is visible until the money moves.
   */
  scale?: number
  message?: string
  scaleMessage?: string
  /**
   * Accept numeric strings (`"10"`) by coercing before validating. Defaults to
   * `true`, which is what a query-string or form value needs.
   *
   * Pass `false` for a JSON body field that was declared `z.number()`.
   * `z.coerce.number()` runs `Number(value)` first, so it turns `true` into `1`
   * and `["10"]` into `10` — on a payment amount that is the difference between
   * rejecting a malformed body and charging for it.
   */
  coerce?: boolean
}

/**
 * A monetary amount as a JS number.
 *
 * Modules previously ranged from `z.number().positive()` (no bound, no
 * precision) through `z.coerce.number().positive().max(999_999_999)` to
 * `z.coerce.number().finite().nonnegative()`. Use this so the bound and the
 * precision rule are stated once, and say which options you need rather than
 * writing a fresh rule.
 */
export function moneyAmountSchema(options: MoneyAmountSchemaOptions = {}) {
  const {
    min = 0,
    max = MONEY_MAX_AMOUNT,
    positive = false,
    scale,
    message,
    scaleMessage,
    coerce = true,
  } = options

  let schema = coerce ? z.coerce.number() : z.number()
  if (max !== null) schema = schema.max(max, message)
  schema = positive ? schema.positive(message) : schema.min(min, message)
  if (scale === undefined) return schema

  return schema.refine((value) => decimalPlaces(value) <= scale, {
    message: scaleMessage ?? `Amount supports at most ${scale} decimal places`,
  })
}

export type MoneyDecimalStringOptions = {
  /** Allow a leading `-`. Defaults to `false`. */
  signed?: boolean
  /** Digits before the decimal point. Defaults to `14`. */
  integerDigits?: number
  /** Digits after the decimal point. Defaults to `4`. */
  scale?: number
  message?: string
}

/**
 * A monetary amount carried as a decimal **string**, for the paths that must not
 * round-trip through a JS number at all (`invoice` transmits document totals
 * this way so its 4-dp arithmetic stays exact).
 *
 * Prefer this over {@link moneyAmountSchema} when the value is persisted to a
 * `numeric` column and summed server-side.
 */
export function moneyDecimalStringSchema(options: MoneyDecimalStringOptions = {}) {
  const { signed = false, integerDigits = 14, scale = 4, message } = options
  const pattern = new RegExp(`^${signed ? '-?' : ''}\\d{1,${integerDigits}}(\\.\\d{1,${scale}})?$`)
  return message ? z.string().trim().regex(pattern, message) : z.string().trim().regex(pattern)
}
