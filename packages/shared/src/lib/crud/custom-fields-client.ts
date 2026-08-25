import { normalizeCustomFieldResponse } from '../custom-fields/normalize'
export function extractCustomFieldEntries(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!item || typeof item !== 'object') return out

  const normalizeValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const inner = trimmed.slice(1, -1).trim()
      if (!inner) return []
      return inner.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean)
    }
    return trimmed
  }

  const assign = (rawKey: unknown, rawValue: unknown) => {
    if (typeof rawKey !== 'string') return
    const trimmed = rawKey.trim()
    if (!trimmed) return
    out[`cf_${trimmed}`] = normalizeValue(rawValue)
  }

  const assignObject = (source: unknown) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      assign(key, value)
    }
  }

  const assignEntries = (source: unknown) => {
    if (!Array.isArray(source)) return
    for (const entry of source as Array<Record<string, unknown>>) {
      if (!entry || typeof entry !== 'object') continue
      const key = typeof entry.key === 'string' ? entry.key : null
      if (!key) continue
      assign(key, 'value' in entry ? (entry as any).value : undefined)
    }
  }

  for (const [rawKey, rawValue] of Object.entries(item)) {
    if (rawKey.startsWith('cf_')) {
      if (rawKey.endsWith('__is_multi')) continue
      out[rawKey] = normalizeValue(rawValue)
    } else if (rawKey.startsWith('cf:')) {
      assign(rawKey.slice(3), rawValue)
    }
  }

  assignObject((item as any).customValues)
  assignObject((item as any).custom_values)
  assignObject((item as any).customFields)
  assignObject((item as any).custom_fields)
  assignEntries((item as any).customFields)
  assignEntries((item as any).custom_fields)

  return out
}

/**
 * Normalizes a custom-field value for submission: an array keeps only defined
 * entries, `undefined` becomes an explicit `null` so the server clears the
 * field rather than ignoring it, everything else passes through.
 */
export const normalizeCustomFieldSubmitValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.filter((entry) => entry !== undefined)
  if (value === undefined) return null
  return value
}

/** Rewrites custom-field keys to the `cf_` form `CrudForm` fields are named with. */
export const prefixCustomFieldValues = (input?: Record<string, unknown> | null): Record<string, unknown> => {
  if (!input || typeof input !== 'object') return {}
  return Object.entries(input).reduce<Record<string, unknown>>((acc, [key, value]) => {
    const trimmedKey = key.trim()
    if (!trimmedKey.length) return acc
    const normalizedKey = trimmedKey.startsWith('cf_')
      ? trimmedKey
      : trimmedKey.startsWith('cf:')
        ? `cf_${trimmedKey.slice(3)}`
        : `cf_${trimmedKey}`
    if (normalizedKey.endsWith('__is_multi')) return acc
    acc[normalizedKey] = value
    return acc
  }, {})
}

/** Pulls the custom fields out of an API payload as `CrudForm` initial values. */
export const extractCustomFieldValues = (source?: Record<string, unknown> | null): Record<string, unknown> => {
  if (!source || typeof source !== 'object') return {}
  const extracted = extractCustomFieldEntries(source)
  const normalized = normalizeCustomFieldResponse(extracted)
  return normalized ? prefixCustomFieldValues(normalized) : prefixCustomFieldValues(extracted)
}
