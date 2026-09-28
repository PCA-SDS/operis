import { resolveTimeoutMs } from '@open-mercato/shared/lib/http/fetchWithTimeout'

export const DEFAULT_RATE_FETCH_TIMEOUT_MS = 15_000

export function resolveRateFetchTimeoutMs(): number {
  const raw = process.env.CURRENCY_RATE_FETCH_TIMEOUT_MS
  const parsed = raw ? Number.parseInt(raw, 10) : undefined
  return resolveTimeoutMs(parsed, DEFAULT_RATE_FETCH_TIMEOUT_MS)
}
