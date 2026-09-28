export function normalizeWorkflowUserId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('trigger:')) return null
  return trimmed
}
