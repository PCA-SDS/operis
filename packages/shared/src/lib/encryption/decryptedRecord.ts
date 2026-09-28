import { isRecord } from '../guards'
import { parseDecryptedFieldValue } from './tenantDataEncryptionService'

/**
 * A JSON object column read back through decryption: already an object, or a
 * decrypted string that parses to one. Anything else becomes an empty record.
 */
export function parseDecryptedRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value
  if (typeof value !== 'string') return {}
  const parsed = parseDecryptedFieldValue(value)
  return isRecord(parsed) ? parsed : {}
}
