/**
 * Money formatting for CRM amounts.
 *
 * Five components each carried a private copy of one of these two functions.
 * They are kept as separate functions rather than one with a fallback option
 * because they disagree on zero: {@link formatAmount} reads a falsy amount —
 * including a numeric `0` — as "no value" and answers `null`, while
 * {@link formatAmountOrDash} formats `0` and reserves the dash for a genuinely
 * absent or non-finite value.
 *
 * Neither is the same as `formatCurrency` in `components/detail/utils.ts`, which
 * deliberately drops the cents, nor the one in `@open-mercato/ui/utils/format`.
 */

/**
 * Format a decimal-string amount. Answers `null` when there is no amount, and
 * echoes an unparseable amount back (with the currency appended when there is
 * one) rather than rendering `NaN`.
 */
export function formatAmount(
  amount: string | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (!amount) return null
  const parsed = Number(amount)
  if (!Number.isFinite(parsed)) return currency ? `${amount} ${currency}` : amount
  if (!currency) return parsed.toLocaleString()
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(parsed)
  } catch {
    return `${parsed.toLocaleString()} ${currency}`
  }
}

/**
 * Format a numeric amount for a slot that always renders something, using an
 * em-dash for an absent or non-finite value.
 */
export function formatAmountOrDash(value: number | null, currency: string | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (!currency) return value.toLocaleString()
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
  } catch {
    return `${value.toLocaleString()} ${currency}`
  }
}
