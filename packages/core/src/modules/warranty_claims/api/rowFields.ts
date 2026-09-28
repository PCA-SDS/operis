export function readString(record: Record<string, unknown>, snakeKey: string, camelKey: string): string | null {
  const value = record[snakeKey] ?? record[camelKey]
  return typeof value === 'string' ? value : null
}

export function readNumber(record: Record<string, unknown>, snakeKey: string, camelKey: string): number | null {
  const value = record[snakeKey] ?? record[camelKey]
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function readBool(record: Record<string, unknown>, snakeKey: string, camelKey: string): boolean {
  const value = record[snakeKey] ?? record[camelKey]
  return value === true
}
