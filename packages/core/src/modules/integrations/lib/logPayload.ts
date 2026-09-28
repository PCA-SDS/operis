export function isPrimitiveLogValue(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

export function splitLogPayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload) {
    return {
      inlineEntries: [] as Array<[string, string | number | boolean | null]>,
      nestedEntries: [] as Array<[string, unknown]>,
    }
  }

  const inlineEntries: Array<[string, string | number | boolean | null]> = []
  const nestedEntries: Array<[string, unknown]> = []

  Object.entries(payload).forEach(([key, value]) => {
    if (isPrimitiveLogValue(value)) {
      inlineEntries.push([key, value])
      return
    }
    nestedEntries.push([key, value])
  })

  return { inlineEntries, nestedEntries }
}

export function formatLogDetailLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}
