import {
  finiteNumberOrNull,
  parseNumberWithDefault,
  readCount,
  toFiniteNumber,
  toFiniteNumberOrNull,
  toNumericString,
} from '../number'

describe('parseNumberWithDefault', () => {
  it('returns the fallback when raw is missing or blank', () => {
    expect(parseNumberWithDefault(undefined, 5)).toBe(5)
    expect(parseNumberWithDefault(null, 5)).toBe(5)
    expect(parseNumberWithDefault('', 5)).toBe(5)
    expect(parseNumberWithDefault('   ', 5)).toBe(5)
  })

  it('parses a valid numeric string', () => {
    expect(parseNumberWithDefault('42', 0)).toBe(42)
    expect(parseNumberWithDefault(' 42 ', 0)).toBe(42)
  })

  it('allows decimals by default, but truncates when integer: true', () => {
    expect(parseNumberWithDefault('4.5', 0)).toBe(4.5)
    expect(parseNumberWithDefault('4.5', 0, { integer: true })).toBe(4)
  })

  it('falls back to the default on a non-numeric string', () => {
    expect(parseNumberWithDefault('not-a-number', 7)).toBe(7)
  })

  it('falls back to the default when below the configured min', () => {
    expect(parseNumberWithDefault('-1', 3, { min: 0 })).toBe(3)
    expect(parseNumberWithDefault('0', 3, { min: 0 })).toBe(0)
  })

  it('has no min by default, so negative values are accepted', () => {
    expect(parseNumberWithDefault('-5', 0)).toBe(-5)
  })
})

describe('finite number readers', () => {
  it('parses finite numbers and non-blank numeric strings', () => {
    expect(toFiniteNumberOrNull(4)).toBe(4)
    expect(toFiniteNumberOrNull(' 2.5 ')).toBe(2.5)
    expect(toFiniteNumberOrNull('')).toBeNull()
    expect(toFiniteNumberOrNull('Infinity')).toBeNull()
    expect(toFiniteNumberOrNull(Number.NaN)).toBeNull()
    expect(toFiniteNumber('x')).toBe(0)
    expect(toFiniteNumber('x', 7)).toBe(7)
  })

  it('accepts only finite number values in finiteNumberOrNull', () => {
    expect(finiteNumberOrNull(3)).toBe(3)
    expect(finiteNumberOrNull('3')).toBeNull()
    expect(toNumericString(12.5)).toBe('12.5')
    expect(toNumericString(null)).toBeNull()
  })

  it('reads counts, parsing strings as base-10 integers', () => {
    expect(readCount(5)).toBe(5)
    expect(readCount('12 rows')).toBe(12)
    expect(readCount('abc')).toBe(0)
    expect(readCount(undefined)).toBe(0)
  })
})
