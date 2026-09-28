export function sanitizeIdList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const set = new Set<string>()
  input.forEach((candidate) => {
    if (typeof candidate !== 'string') return
    const trimmed = candidate.trim()
    if (!trimmed.length) return
    set.add(trimmed)
  })
  return Array.from(set)
}

export function sameIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((value) => rightSet.has(value))
}
