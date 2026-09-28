/**
 * Reads one cookie's raw value from a `Cookie` request header.
 *
 * Pure and runtime-neutral, so middleware, route handlers and server helpers
 * share it; `auth/server`, the customer portal and the translations locale
 * resolver each carried a copy. The value is returned as sent — callers decode
 * it if they encoded it.
 */
export function readCookieFromHeader(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined
  const parts = header.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1)
    }
  }
  return undefined
}
