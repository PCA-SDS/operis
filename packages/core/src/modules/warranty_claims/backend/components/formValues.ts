import { toFiniteNumberOrNull } from '@open-mercato/shared/lib/number'

export function nullableInteger(value: unknown): number | null {
  const parsed = toFiniteNumberOrNull(value)
  if (parsed === null) return null
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

export function dateInputValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed
}

export function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}
