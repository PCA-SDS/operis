import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'

export const DEFAULT_MAX_TEXT_SIZE = 204800
export const DEFAULT_TRANSLATION_TIMEOUT_MS = 30000
export const DEFAULT_PRICE_MISMATCH_THRESHOLD = 0.05

/**
 * Maximum characters of email text retained for LLM extraction.
 *
 * The value feeds `String.prototype.slice`, and `slice(0, NaN)` yields an empty
 * string rather than the full text — so a malformed env var would silently drop
 * every email body instead of truncating it.
 */
export function resolveMaxTextSize(): number {
  return parseNumberWithDefault(process.env.INBOX_OPS_MAX_TEXT_SIZE, DEFAULT_MAX_TEXT_SIZE, {
    min: 1,
    integer: true,
  })
}

export function resolveTranslationTimeoutMs(): number {
  return parseNumberWithDefault(
    process.env.INBOX_OPS_TRANSLATION_TIMEOUT_MS,
    DEFAULT_TRANSLATION_TIMEOUT_MS,
    { min: 1, integer: true },
  )
}

/**
 * Relative price difference above which a discrepancy is reported.
 *
 * A NaN threshold makes the `priceDiff > threshold` comparison false for every
 * line, which disables price-mismatch detection without reporting anything.
 */
export function resolvePriceMismatchThreshold(): number {
  return parseNumberWithDefault(
    process.env.INBOX_OPS_PRICE_MISMATCH_THRESHOLD,
    DEFAULT_PRICE_MISMATCH_THRESHOLD,
    { min: 0 },
  )
}
