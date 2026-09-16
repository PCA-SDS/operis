/**
 * Zod preprocessors shared across module `data/validators.ts` files.
 */

/**
 * Turn a blank or whitespace-only string into `null`, and trim everything else.
 * Non-strings pass through untouched so the wrapped schema still sees — and
 * reports on — the original value.
 *
 * Pair it with a nullable schema to make a field clearable from a form, which is
 * what every caller uses it for:
 *
 * ```ts
 * const clearableString = (max: number) =>
 *   z.preprocess(emptyStringToNull, z.string().trim().max(max).nullable().optional())
 * ```
 */
export const emptyStringToNull = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}
