import { z } from 'zod'

/** ISO 4217 alphabetic code: exactly three upper-case letters. */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/

export type CurrencyCodeSchemaOptions = {
  /** Message or i18n key for a malformed code. */
  message?: string
  /**
   * Upper-case the input before validating, so `"usd"` is accepted and stored as
   * `"USD"`. Defaults to `true`.
   *
   * `catalog` and `sales` deliberately pass `false`: they validate codes that
   * arrive from imports and price feeds, where a lower-case code signals a
   * malformed feed rather than a user typing casually, and silently normalizing
   * it would hide the problem.
   */
  normalizeCase?: boolean
}

/**
 * The canonical ISO-4217 currency-code schema.
 *
 * Replaces six mutually incompatible variants — including one that was only
 * `z.string().min(3).max(3)` and therefore accepted `"ab1"`. This validates the
 * charset in every case; `normalizeCase` is the one axis that legitimately
 * differs between callers.
 */
export function currencyCodeSchema(options: CurrencyCodeSchemaOptions = {}) {
  const { message, normalizeCase = true } = options
  const base = normalizeCase ? z.string().trim().toUpperCase() : z.string().trim()
  return message ? base.regex(CURRENCY_CODE_PATTERN, message) : base.regex(CURRENCY_CODE_PATTERN)
}
