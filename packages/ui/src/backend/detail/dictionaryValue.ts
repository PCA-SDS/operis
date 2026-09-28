export function extractDictionaryValue(entry: unknown): string | null {
  if (typeof entry === 'string') {
    const trimmed = entry.trim()
    return trimmed.length ? trimmed : null
  }
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const candidate = record.value ?? record.name ?? record.id ?? record.key ?? record.label
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim()
    return trimmed.length ? trimmed : null
  }
  return null
}
