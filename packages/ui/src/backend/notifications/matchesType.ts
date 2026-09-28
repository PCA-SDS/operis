export function matchesType(pattern: string | string[], type: string): boolean {
  const patterns = Array.isArray(pattern) ? pattern : [pattern]
  return patterns.some((current) => {
    if (current === '*') return true
    if (current.endsWith('.*')) return type.startsWith(current.slice(0, -1))
    return current === type
  })
}
