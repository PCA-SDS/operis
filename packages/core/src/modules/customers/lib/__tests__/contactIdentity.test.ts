/** @jest-environment node */

import {
  computeEmailLookupHash,
  computePhoneLookupHash,
  emailLookupHashCandidates,
  normalizeDialCode,
  normalizePhoneCountry,
  phoneLookupHashCandidates,
  resolvePhoneIdentity,
} from '../contactIdentity'

describe('phone lookup hash', () => {
  it('collapses formatting differences to one identity', () => {
    const canonical = computePhoneLookupHash('+6591234567')
    expect(canonical).not.toBeNull()
    expect(computePhoneLookupHash('+65 9123 4567')).toBe(canonical)
    expect(computePhoneLookupHash('+65-9123-4567')).toBe(canonical)
    expect(computePhoneLookupHash('  +65 (9123) 4567 ')).toBe(canonical)
  })

  it('separates different numbers', () => {
    expect(computePhoneLookupHash('+6591234567')).not.toBe(computePhoneLookupHash('+6591234568'))
  })

  it('returns null when there are no digits', () => {
    expect(computePhoneLookupHash('')).toBeNull()
    expect(computePhoneLookupHash('   ')).toBeNull()
    expect(computePhoneLookupHash(null)).toBeNull()
    expect(computePhoneLookupHash(undefined)).toBeNull()
  })

  // `hashForLookup` only applies its context once a pepper is configured;
  // without one it falls back to the legacy unkeyed digest, which ignores it.
  it('is domain-separated from the email hash when a lookup pepper is configured', () => {
    const previous = process.env.LOOKUP_HASH_PEPPER
    process.env.LOOKUP_HASH_PEPPER = 'test-pepper'
    try {
      jest.isolateModules(() => {
        const identity = require('../contactIdentity')
        expect(identity.computePhoneLookupHash('123456')).not.toBe(identity.computeEmailLookupHash('123456'))
      })
    } finally {
      if (previous === undefined) delete process.env.LOOKUP_HASH_PEPPER
      else process.env.LOOKUP_HASH_PEPPER = previous
    }
  })

  it('always includes the current hash among its candidates', () => {
    const candidates = phoneLookupHashCandidates('+65 9123 4567')
    expect(candidates).toContain(computePhoneLookupHash('+6591234567'))
    expect(phoneLookupHashCandidates('')).toEqual([])
  })
})

describe('email lookup hash', () => {
  it('is case and whitespace insensitive', () => {
    const canonical = computeEmailLookupHash('ada@example.com')
    expect(canonical).not.toBeNull()
    expect(computeEmailLookupHash('  ADA@Example.COM ')).toBe(canonical)
  })

  it('returns null / no candidates for blank input', () => {
    expect(computeEmailLookupHash('   ')).toBeNull()
    expect(emailLookupHashCandidates(null)).toEqual([])
  })
})

describe('phone country normalization', () => {
  it('reduces a dial code to digits', () => {
    expect(normalizeDialCode('+65')).toBe('65')
    expect(normalizeDialCode('65')).toBe('65')
    expect(normalizeDialCode('+1 268')).toBe('1268')
    expect(normalizeDialCode('')).toBeNull()
    expect(normalizeDialCode(null)).toBeNull()
  })

  it('upper-cases ISO alpha-2 and rejects anything else', () => {
    expect(normalizePhoneCountry('sg')).toBe('SG')
    expect(normalizePhoneCountry(' Vn ')).toBe('VN')
    expect(normalizePhoneCountry('Singapore')).toBeNull()
    expect(normalizePhoneCountry('S')).toBeNull()
    expect(normalizePhoneCountry('')).toBeNull()
  })
})

describe('resolvePhoneIdentity', () => {
  it('keeps the display value while deriving hash and country parts', () => {
    const identity = resolvePhoneIdentity({
      primaryPhone: '+84 912 345 678',
      phoneCountryCode: '+84',
      phoneCountry: 'vn',
    })
    expect(identity.primaryPhone).toBe('+84 912 345 678')
    expect(identity.primaryPhoneHash).toBe(computePhoneLookupHash('+84912345678'))
    expect(identity.phoneCountryCode).toBe('84')
    expect(identity.phoneCountry).toBe('VN')
  })

  it('clears every derived part when the phone is removed', () => {
    const identity = resolvePhoneIdentity({ primaryPhone: '', phoneCountryCode: null, phoneCountry: null })
    expect(identity).toEqual({
      primaryPhone: null,
      primaryPhoneHash: null,
      phoneCountryCode: null,
      phoneCountry: null,
    })
  })
})
