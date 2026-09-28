import type { SearchResultLink, SearchResult } from '@open-mercato/shared/modules/search'

export function normalizeLinks(links?: SearchResultLink[] | null): SearchResultLink[] {
  if (!Array.isArray(links)) return []
  return links.filter((link) => typeof link?.href === 'string')
}

export function pickPrimaryLink(result: SearchResult): string | null {
  if (result.url) return result.url
  const links = normalizeLinks(result.links)
  if (!links.length) return null
  const primary = links.find((link) => link.kind === 'primary')
  return (primary ?? links[0]).href
}
