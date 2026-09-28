import { ACTION_LOG_FILTER_TYPES } from '@open-mercato/core/modules/audit_logs/lib/projections'
import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'

export function parseNumber(param: string | null, { min, max, fallback }: { min: number; max: number; fallback: number }) {
  if (!param) return fallback
  const value = Number(param)
  if (!Number.isFinite(value)) return fallback
  const normalized = Math.trunc(value)
  if (Number.isNaN(normalized)) return fallback
  return Math.min(Math.max(normalized, min), max)
}

export function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined
  const ts = Date.parse(value)
  if (Number.isNaN(ts)) return undefined
  return new Date(ts)
}

export const ACTION_TYPE_TOKENS = ACTION_LOG_FILTER_TYPES

export function parseActionTypes(param: string | null) {
  return parseCommaSeparatedList(param).filter((value): value is (typeof ACTION_TYPE_TOKENS)[number] =>
    ACTION_TYPE_TOKENS.includes(value as (typeof ACTION_TYPE_TOKENS)[number]),
  )
}
