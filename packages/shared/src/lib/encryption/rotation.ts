import crypto from 'node:crypto'
import { decryptWithAesGcm } from './aes'
import type { TenantDek } from './kms'

/** A short, log-safe fingerprint of a tenant key, or `null` when there is no key. */
export function fingerprintDek(dek: TenantDek | null): string | null {
  if (!dek?.key) return null
  return crypto.createHash('sha256').update(dek.key).digest('hex').slice(0, 12)
}

/** Decrypts `payload` with a key being rotated out; `null` when there is no key. */
export function decryptWithOldKey(payload: string, dek: TenantDek | null): string | null {
  if (!dek?.key) return null
  return decryptWithAesGcm(payload, dek.key)
}
