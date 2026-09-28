import { formatDate } from '@open-mercato/shared/lib/time'

export function formatQuantityKg(value: number | string | null, emptyLabel: string): string {
  if (value === null || value === undefined) return emptyLabel
  if (typeof value === 'string' && !value.trim()) return emptyLabel
  return String(value)
}

export function formatDeadlineDate(value: string, locale: string): string {
  return formatDate(`${value}T00:00:00.000Z`, { locale, fallback: value })
}
