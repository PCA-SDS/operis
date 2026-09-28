import {
  nonEmptyStringOrNull,
  parseCommaSeparatedList,
  readStringField,
  readTrimmedString,
  toNonEmptyStringArray,
  trimToUndefined,
} from '../string'

describe('parseCommaSeparatedList', () => {
  it('splits a comma-separated string into entries', () => {
    expect(parseCommaSeparatedList('low,medium,high')).toEqual(['low', 'medium', 'high'])
  })

  it('trims surrounding whitespace from every entry', () => {
    expect(parseCommaSeparatedList(' admin ,  editor,viewer  ')).toEqual(['admin', 'editor', 'viewer'])
  })

  it('drops empty entries produced by repeated or trailing separators', () => {
    expect(parseCommaSeparatedList('a,,b,')).toEqual(['a', 'b'])
    expect(parseCommaSeparatedList(',a, ,b')).toEqual(['a', 'b'])
  })

  it('returns an empty array when every entry is blank', () => {
    expect(parseCommaSeparatedList(',,')).toEqual([])
    expect(parseCommaSeparatedList('  ,  ')).toEqual([])
  })

  it('returns an empty array for blank or non-string inputs', () => {
    expect(parseCommaSeparatedList('')).toEqual([])
    expect(parseCommaSeparatedList('   ')).toEqual([])
    expect(parseCommaSeparatedList(null)).toEqual([])
    expect(parseCommaSeparatedList(undefined)).toEqual([])
  })

  it('returns a single entry when the input has no separator', () => {
    expect(parseCommaSeparatedList('admin')).toEqual(['admin'])
    expect(parseCommaSeparatedList('  admin  ')).toEqual(['admin'])
  })

  it('preserves interior whitespace within an entry', () => {
    expect(parseCommaSeparatedList('order created, order shipped')).toEqual(['order created', 'order shipped'])
  })
})

describe('trimToUndefined', () => {
  it('returns the trimmed value when it is a non-blank string', () => {
    expect(trimToUndefined('  value  ')).toBe('value')
  })

  it('returns undefined for blank or non-string values', () => {
    expect(trimToUndefined('   ')).toBeUndefined()
    expect(trimToUndefined(null)).toBeUndefined()
    expect(trimToUndefined(42)).toBeUndefined()
  })
})

describe('record and string readers', () => {
  const record = { name: '  Ada ', blank: '   ', count: 3 }

  it('reads a trimmed non-blank string field', () => {
    expect(readTrimmedString(record, 'name')).toBe('Ada')
    expect(readTrimmedString(record, 'blank')).toBeNull()
    expect(readTrimmedString(record, 'count')).toBeNull()
    expect(readTrimmedString(record, 'missing')).toBeNull()
  })

  it('reads a string field as given', () => {
    expect(readStringField(record, 'name')).toBe('  Ada ')
    expect(readStringField(record, 'blank')).toBe('   ')
    expect(readStringField(record, 'count')).toBeNull()
  })

  it('keeps non-empty strings untrimmed and filters string arrays', () => {
    expect(nonEmptyStringOrNull(' a ')).toBe(' a ')
    expect(nonEmptyStringOrNull('')).toBeNull()
    expect(nonEmptyStringOrNull(1)).toBeNull()
    expect(toNonEmptyStringArray(['a', ' ', 2, 'b'])).toEqual(['a', 'b'])
    expect(toNonEmptyStringArray('a')).toEqual([])
  })
})
