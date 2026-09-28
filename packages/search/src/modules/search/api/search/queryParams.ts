export function parseEntityTypes(value: string | null): string[] | undefined {
  if (!value) return undefined
  const entityTypes = value.split(',').map((s) => s.trim()).filter(Boolean)
  return entityTypes.length > 0 ? entityTypes : undefined
}

export function parseLimit(value: string | null): number {
  if (!value) return 50
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return 50
  return Math.min(parsed, 100)
}
