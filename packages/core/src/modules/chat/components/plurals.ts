import * as React from 'react'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * Probe value for "this key is not in the dictionary".
 *
 * `t` resolves `dict[key] ?? fallback ?? key`, so asking for a key always
 * returns something and a missing key is indistinguishable from a present one.
 * Passing a value no translator would ever type makes absence detectable
 * without reaching into the dictionary, which the i18n context does not expose.
 */
const MISSING = '\u0000om:missing\u0000'

/**
 * Which key holds the wording for a plural category.
 *
 * The first two rows are the module's existing convention, unchanged - which is
 * what makes this non-breaking. English, German and Spanish only ever produce
 * `one` and `other`, so they resolve to exactly the keys they resolve to today.
 * Korean only ever produces `other`, and its singular and plural strings are
 * identical, so it is unaffected too.
 *
 *   one    -> `key`         (the existing singular)
 *   other  -> `key_plural`  (the existing plural)
 *   few    -> `key_few`
 *   many   -> `key_many`
 *   two    -> `key_two`
 *   zero   -> `key_zero`
 */
function keyForCategory(baseKey: string, category: Intl.LDMLPluralRule): string {
  if (category === 'one') return baseKey
  if (category === 'other') return `${baseKey}_plural`
  return `${baseKey}_${category}`
}

/**
 * Memoised: a transcript renders counts on many rows, and constructing
 * `Intl.PluralRules` per call is not free.
 */
const rulesByLocale = new Map<string, Intl.PluralRules>()
function rulesFor(locale: string): Intl.PluralRules {
  let rules = rulesByLocale.get(locale)
  if (!rules) {
    // An unknown locale tag throws rather than degrading, and a bad tag must not
    // take a page down over a word ending.
    try {
      rules = new Intl.PluralRules(locale)
    } catch {
      rules = new Intl.PluralRules('en')
    }
    rulesByLocale.set(locale, rules)
  }
  return rules
}

/**
 * Resolve a count-dependent translation.
 *
 * The locale files followed a two-form convention - `key` and `key_plural`,
 * chosen on `count === 1`. That is right for English, German and Spanish, and
 * harmless for Korean, which draws no singular/plural distinction at all. It is
 * wrong for Polish, which has three categories: `one` for 1, `few` for 2-4 (and
 * 22-24, 32-34...), and `many` for 5-21 and 25+. With only two forms the Polish
 * strings carried the *many* wording everywhere, so the `few` range read
 * incorrectly on ordinary numbers, not edge cases.
 *
 * `Intl.PluralRules` is the CLDR data the platform already ships, so this needs
 * no dependency and no table of our own to drift.
 *
 * A category with no key of its own falls back to `key_plural`, so a base key
 * that has not been given `_few`/`_many` behaves exactly as it did before. That
 * fallback is what lets this land without touching every pluralised string in
 * the repo at once.
 */
export function tCount(
  t: TranslateFn,
  locale: string,
  baseKey: string,
  count: number,
  fallback: string,
  params?: Record<string, unknown>,
): string {
  const category = rulesFor(locale).select(count)
  const resolvedParams = { count, ...params }

  const direct = t(keyForCategory(baseKey, category), MISSING, resolvedParams)
  if (direct !== MISSING) return direct

  // No wording for this category; the generic plural is the closest thing this
  // locale actually has.
  const plural = t(`${baseKey}_plural`, MISSING, resolvedParams)
  if (plural !== MISSING) return plural

  return t(baseKey, fallback, resolvedParams)
}

export type TCountFn = (
  baseKey: string,
  count: number,
  fallback: string,
  params?: Record<string, unknown>,
) => string

/**
 * `tCount` bound to the active translator and locale.
 *
 * Call sites already hold `t`; threading the locale through every one of them
 * as well put an extra argument in front of each count for something ambient.
 */
export function useTCount(): TCountFn {
  const t = useT()
  const locale = useLocale()
  return React.useCallback(
    (baseKey, count, fallback, params) => tCount(t, locale, baseKey, count, fallback, params),
    [t, locale],
  )
}
