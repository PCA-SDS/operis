/** @jest-environment node */

import { resolvePhoneIdentity, normalizeDialCode } from '../phoneIdentity'

describe('phoneIdentity', () => {
  it('stores explicit dial code metadata separately from the phone value', () => {
    const identity = resolvePhoneIdentity({
      primaryPhone: '+84 912 345 678',
      phoneCountryCode: '+84',
      phoneCountry: 'vn',
    })
    expect(identity.primaryPhone).toBe('+84 912 345 678')
    expect(identity.phoneCountryCode).toBe('84')
    expect(identity.phoneCountry).toBe('vn')
  })

  it('normalizes dial code strings', () => {
    expect(normalizeDialCode('+65')).toBe('65')
    expect(normalizeDialCode('65')).toBe('65')
    expect(normalizeDialCode('')).toBeNull()
  })
})
