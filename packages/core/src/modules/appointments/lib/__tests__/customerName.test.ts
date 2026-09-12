/** @jest-environment node */

import { formatCustomerDisplayName, splitCustomerName } from '../customerName'

describe('splitCustomerName', () => {
  it('splits first and remaining tokens', () => {
    expect(splitCustomerName('Ada Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' })
    expect(splitCustomerName('  Tiến  Công  ')).toEqual({ firstName: 'Tiến', lastName: 'Công' })
  })

  it('uses "-" when only one token', () => {
    expect(splitCustomerName('Madonna')).toEqual({ firstName: 'Madonna', lastName: '-' })
  })

  it('returns empty strings for blank input', () => {
    expect(splitCustomerName('   ')).toEqual({ firstName: '', lastName: '' })
  })
})

describe('formatCustomerDisplayName', () => {
  it('prefixes salutation when present', () => {
    expect(formatCustomerDisplayName('Mr', 'Ada Lovelace')).toBe('Mr. Ada Lovelace')
  })

  it('skips None and blank salutations', () => {
    expect(formatCustomerDisplayName('None', 'Ada')).toBe('Ada')
    expect(formatCustomerDisplayName(null, 'Ada')).toBe('Ada')
    expect(formatCustomerDisplayName('  ', 'Ada')).toBe('Ada')
  })
})
