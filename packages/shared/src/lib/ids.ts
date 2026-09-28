import { createHash } from 'node:crypto'

/**
 * A deterministic UUID-shaped id derived from `stableKey` (SHA-256, formatted
 * 8-4-4-4-12), so a module can seed the same row, such as a scheduled job, on
 * every run without looking it up first.
 *
 * It is not an RFC 4122/9562 UUID: no version or variant bits are set. A
 * validator that checks those (`z.uuid()`, the strict pattern in `crud/ids`)
 * rejects it; a column typed `uuid` accepts it.
 */
export function stableUuidFromKey(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
