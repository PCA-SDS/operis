import {
  numberOption,
  parseCliArgs,
  parseCliValueArgs,
  stringOption,
  toNonNegativeInt,
  toPositiveInt,
} from '../args'

describe('parseCliArgs', () => {
  it('reads --key value, --key=value and bare flags', () => {
    expect(parseCliArgs(['--tenant', 't1', '--org=o1', '--dry-run'])).toEqual({
      tenant: 't1',
      org: 'o1',
      'dry-run': true,
    })
  })

  it('keeps only the segment after the first = as the value', () => {
    expect(parseCliArgs(['--filter=a=b'])).toEqual({ filter: 'a' })
  })

  it('does not take a following flag as a value', () => {
    expect(parseCliArgs(['--force', '--tenant', 't1'])).toEqual({ force: true, tenant: 't1' })
  })

  it('skips positional tokens and an empty key', () => {
    expect(parseCliArgs(['reindex', '--=x', '--limit', '5'])).toEqual({ limit: '5' })
  })

  it('reads an empty value as a bare flag by default', () => {
    expect(parseCliArgs(['--tenant', ''])).toEqual({ tenant: true })
  })

  it('keeps an empty value when asked to', () => {
    expect(parseCliArgs(['--tenant', ''], { keepEmptyValues: true })).toEqual({ tenant: '' })
    expect(parseCliArgs(['--tenant'], { keepEmptyValues: true })).toEqual({ tenant: true })
  })
})

describe('parseCliValueArgs', () => {
  it('ignores flags without a value', () => {
    expect(parseCliValueArgs(['--tenant', 't1', '--verbose'])).toEqual({ tenant: 't1' })
  })

  it('keeps an earlier value when the key is repeated bare', () => {
    expect(parseCliValueArgs(['--tenant', 't1', '--tenant'])).toEqual({ tenant: 't1' })
  })

  it('does not treat an empty token as a value', () => {
    expect(parseCliValueArgs(['--tenant', '', '--org=o1'])).toEqual({ org: 'o1' })
  })
})

describe('option readers', () => {
  const args = { tenant: '  t1 ', blank: '  ', flag: true, limit: '25', bad: 'x' }

  it('returns the first non-blank string option, trimmed', () => {
    expect(stringOption(args, 'blank', 'tenant')).toBe('t1')
    expect(stringOption(args, 'flag')).toBeUndefined()
  })

  it('returns the first finite numeric option', () => {
    expect(numberOption(args, 'bad', 'limit')).toBe(25)
    expect(numberOption(args, 'flag')).toBeUndefined()
  })

  it('clamps integers', () => {
    expect(toPositiveInt(2.9)).toBe(2)
    expect(toPositiveInt(0)).toBeUndefined()
    expect(toPositiveInt(undefined)).toBeUndefined()
    expect(toNonNegativeInt(-1, 7)).toBe(7)
    expect(toNonNegativeInt(3.2)).toBe(3)
  })
})
