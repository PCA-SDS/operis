import { toRecord } from '@open-mercato/shared/lib/guards'

export function relationId(value: unknown): string | null {
  if (typeof value === 'string') return value
  const record = toRecord(value)
  return typeof record.id === 'string' ? record.id : null
}
