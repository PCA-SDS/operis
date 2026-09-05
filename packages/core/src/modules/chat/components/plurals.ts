import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * Resolve a count-dependent translation.
 *
 * The module's locale files follow the `_plural` suffix convention, and every
 * surface that shows a count was restating the branch inline — seven copies of
 * `` `key${n === 1 ? '' : '_plural'}` ``, one of which had already produced
 * "1 unread chat messages" once. The rule belongs in one place: get the branch
 * wrong here and every count is wrong together, which is a bug you find.
 *
 * `count` is passed through as a parameter too, so the caller does not repeat
 * it in the params object.
 */
export function tCount(
  t: TranslateFn,
  baseKey: string,
  count: number,
  fallback: string,
  params?: Record<string, unknown>,
): string {
  return t(`${baseKey}${count === 1 ? '' : '_plural'}`, fallback, { count, ...params })
}
