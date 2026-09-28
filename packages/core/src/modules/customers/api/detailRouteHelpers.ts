import { NextResponse } from 'next/server'

export function parseDateValue(value: unknown): string | null {
  if (value instanceof Date) {
    const ts = value.getTime()
    return Number.isNaN(ts) ? null : value.toISOString()
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const candidate = new Date(trimmed)
    if (!Number.isNaN(candidate.getTime())) return candidate.toISOString()
  }
  return null
}

export function parseIncludeParams(request: Request): Set<string> {
  const url = new URL(request.url)
  const raw = url.searchParams.getAll('include')
  const tokens = new Set<string>()
  raw.forEach((entry) => {
    if (!entry) return
    entry
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0)
      .forEach((part) => tokens.add(part))
  })
  return tokens
}

export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

export function forbidden(message: string) {
  return NextResponse.json({ error: message }, { status: 403 })
}

export function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 })
}
