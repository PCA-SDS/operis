import { normalizeAkeneoDateTime, sanitizeAkeneoProductNextUrl } from './client'
import { normalizeOptionalString } from '@open-mercato/shared/lib/string'

type AkeneoCursorState = {
  kind: 'products' | 'list'
  nextUrl?: string | null
  updatedAfter?: string | null
  maxUpdatedAt?: string | null
}

function normalizeProductCursorDateTime(value: unknown): string | null {
  return normalizeAkeneoDateTime(normalizeOptionalString(value))
}

function normalizeProductCursorNextUrl(value: unknown): string | null {
  const normalized = normalizeOptionalString(value)
  return normalized ? sanitizeAkeneoProductNextUrl(normalized) : null
}

export function serializeCursor(state: AkeneoCursorState): string {
  return JSON.stringify(state)
}

export function parseCursor(raw: string | undefined | null): AkeneoCursorState | null {
  if (!raw || raw.trim().length === 0) return null
  try {
    const parsed = JSON.parse(raw) as AkeneoCursorState
    if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') return null
    return {
      kind: parsed.kind === 'list' ? 'list' : 'products',
      nextUrl: parsed.kind === 'list'
        ? normalizeOptionalString(parsed.nextUrl)
        : normalizeProductCursorNextUrl(parsed.nextUrl),
      updatedAfter: normalizeProductCursorDateTime(parsed.updatedAfter),
      maxUpdatedAt: normalizeProductCursorDateTime(parsed.maxUpdatedAt),
    }
  } catch {
    return null
  }
}

export function buildProductResumeCursor(current: { updatedAfter?: string | null; nextUrl?: string | null; maxUpdatedAt?: string | null }): string {
  return serializeCursor({
    kind: 'products',
    updatedAfter: normalizeProductCursorDateTime(current.updatedAfter),
    nextUrl: normalizeProductCursorNextUrl(current.nextUrl),
    maxUpdatedAt: normalizeProductCursorDateTime(current.maxUpdatedAt),
  })
}

export function buildListResumeCursor(nextUrl?: string | null): string {
  return serializeCursor({
    kind: 'list',
    nextUrl: normalizeOptionalString(nextUrl),
  })
}
