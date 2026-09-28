import { UUID_SHAPE_PATTERN } from '@open-mercato/shared/lib/validation'

export function readUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return UUID_SHAPE_PATTERN.test(normalized)
    ? normalized
    : null
}
