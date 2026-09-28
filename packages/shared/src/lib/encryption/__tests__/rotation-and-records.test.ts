import { encryptWithAesGcm, generateDek } from '../aes'
import { parseDecryptedRecord } from '../decryptedRecord'
import { decryptWithOldKey, fingerprintDek } from '../rotation'

describe('key rotation helpers', () => {
  const dek = { tenantId: 't1', key: generateDek(), fetchedAt: 0 }

  it('decrypts with the outgoing key and returns null without one', () => {
    const payload = encryptWithAesGcm('secret value', dek.key).value as string
    expect(decryptWithOldKey(payload, dek)).toBe('secret value')
    expect(decryptWithOldKey(payload, null)).toBeNull()
  })

  it('fingerprints a key with a short stable hash', () => {
    const fingerprint = fingerprintDek(dek)
    expect(fingerprint).toMatch(/^[0-9a-f]{12}$/)
    expect(fingerprintDek(dek)).toBe(fingerprint)
    expect(fingerprintDek(null)).toBeNull()
  })
})

describe('parseDecryptedRecord', () => {
  it('passes records through and parses JSON object strings', () => {
    const record = { a: 1 }
    expect(parseDecryptedRecord(record)).toBe(record)
    expect(parseDecryptedRecord('{"b":2}')).toEqual({ b: 2 })
  })

  it('answers an empty record for anything else', () => {
    expect(parseDecryptedRecord('[1,2]')).toEqual({})
    expect(parseDecryptedRecord('plain text')).toEqual({})
    expect(parseDecryptedRecord(42)).toEqual({})
    expect(parseDecryptedRecord(null)).toEqual({})
  })
})
