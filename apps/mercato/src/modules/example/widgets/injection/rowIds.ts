export function readRowId(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null
  const value = (row as Record<string, unknown>).id
  if (typeof value !== 'string' || value.length === 0) return null
  return value
}
