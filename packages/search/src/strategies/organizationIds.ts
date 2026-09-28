import type { SearchOptions } from '../types'

export function normalizeOrganizationIds(options: SearchOptions): string[] | null {
  const single = typeof options.organizationId === 'string' ? options.organizationId.trim() : ''
  if (single) return [single]
  if (!Array.isArray(options.organizationIds)) return null
  return Array.from(new Set(
    options.organizationIds
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0),
  ))
}
