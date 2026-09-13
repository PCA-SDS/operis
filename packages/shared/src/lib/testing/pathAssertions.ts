/**
 * Path helpers for tests that assert on filesystem paths.
 *
 * Windows produces `\`-separated paths where CI and macOS produce `/`, so an
 * assertion written against a literal path fails on one platform or the other.
 * Normalizing both sides makes the assertion platform-independent.
 */
export function normalizeTestPath(value: string): string {
  return value.replace(/\\/g, '/')
}

export function pathIncludes(value: string, needle: string): boolean {
  return normalizeTestPath(value).includes(normalizeTestPath(needle))
}
