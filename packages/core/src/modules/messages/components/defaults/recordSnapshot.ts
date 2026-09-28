export function readSnapshotLabel(snapshot: Record<string, unknown> | undefined): string | null {
  if (!snapshot) return null

  const candidates = ['subject', 'title', 'name', 'label', 'id']
  for (const key of candidates) {
    const value = snapshot[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

export function readSnapshotSubtitle(snapshot: Record<string, unknown> | undefined): string | null {
  if (!snapshot) return null

  const candidates = ['type', 'status']
  for (const key of candidates) {
    const value = snapshot[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}
