import { isRecord } from '@open-mercato/shared/lib/guards'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export function readErrorKey(value: unknown): string | null {
  if (!isRecord(value)) return null
  return typeof value.error === 'string' && value.error.trim().length ? value.error.trim() : null
}

export function toApiError(status: number, result: unknown, fallbackKey: string, t: TranslateFn): Error & { status?: number } {
  const key = readErrorKey(result) ?? fallbackKey
  return Object.assign(new Error(t(key, key)), { status })
}
