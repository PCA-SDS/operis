export function normalizeCustomFieldSubmitValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined)
  }
  if (value === undefined) return null
  return value
}
