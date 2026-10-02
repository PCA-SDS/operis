export function buildHrefWithReturnTo(href: string, returnTo?: string | null): string {
  const normalizedHref = typeof href === 'string' ? href.trim() : ''
  const normalizedReturnTo = typeof returnTo === 'string' ? returnTo.trim() : ''

  if (!normalizedHref.length || !normalizedReturnTo.length) {
    return normalizedHref
  }

  const hashIndex = normalizedHref.indexOf('#')
  const baseHref = hashIndex >= 0 ? normalizedHref.slice(0, hashIndex) : normalizedHref
  const hash = hashIndex >= 0 ? normalizedHref.slice(hashIndex) : ''

  const queryIndex = baseHref.indexOf('?')
  const pathname = queryIndex >= 0 ? baseHref.slice(0, queryIndex) : baseHref
  const query = queryIndex >= 0 ? baseHref.slice(queryIndex + 1) : ''
  const params = new URLSearchParams(query)

  if (!params.has('returnTo')) {
    params.set('returnTo', normalizedReturnTo)
  }

  const nextQuery = params.toString()
  return `${pathname}${nextQuery.length ? `?${nextQuery}` : ''}${hash}`
}

const RETURN_TO_BASE = 'http://return-to.invalid'

/**
 * The `returnTo` query value as a safe in-app path, or `null`.
 *
 * It becomes a link target, so anything that leaves the app is refused: an
 * absolute URL to another origin, a protocol-relative `//host`, or a path that
 * normalizes to `//` (the same rules as the auth module's redirect sanitizer).
 */
export function resolveReturnToParam(
  searchParams: Record<string, string | string[] | undefined> | null | undefined,
): string | null {
  const raw = searchParams?.returnTo
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value.startsWith('/')) return null
  try {
    const resolved = new URL(value, RETURN_TO_BASE)
    if (resolved.origin !== RETURN_TO_BASE) return null
    if (resolved.pathname.includes('//')) return null
    return resolved.pathname + resolved.search + resolved.hash
  } catch {
    return null
  }
}
