import { isRecord, isStringArray, toRecord, toRecordOrNull } from '../guards'

describe('record guards', () => {
  it('treats plain objects as records and rejects null, arrays and primitives', () => {
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord(Object.create(null))).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord([])).toBe(false)
    expect(isRecord('x')).toBe(false)
    expect(isRecord(0)).toBe(false)
  })

  it('narrows string arrays only', () => {
    expect(isStringArray(['a', 'b'])).toBe(true)
    expect(isStringArray([])).toBe(true)
    expect(isStringArray(['a', 1])).toBe(false)
    expect(isStringArray('a')).toBe(false)
  })

  it('coerces to a record, empty or null when the value is not one', () => {
    const value = { a: 1 }
    expect(toRecord(value)).toBe(value)
    expect(toRecord([1])).toEqual({})
    expect(toRecord(undefined)).toEqual({})
    expect(toRecordOrNull(value)).toBe(value)
    expect(toRecordOrNull([1])).toBeNull()
    expect(toRecordOrNull('x')).toBeNull()
  })
})
