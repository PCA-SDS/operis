export function buildOptionsUrl(base: string, query?: string): string {
  if (!query) return base
  try {
    const isAbsolute = /^([a-z][a-z\d+\-.]*:)?\/\//i.test(base)
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const url = isAbsolute ? new URL(base) : new URL(base, origin)
    if (!url.searchParams.has('query')) url.searchParams.append('query', query)
    if (!url.searchParams.has('q')) url.searchParams.append('q', query)
    if (isAbsolute) return url.toString()
    return `${url.pathname}${url.search}`
  } catch {
    const sep = base.includes('?') ? '&' : '?'
    if (base.includes('query=')) return `${base}${sep}q=${encodeURIComponent(query)}`
    return `${base}${sep}query=${encodeURIComponent(query)}`
  }
}
