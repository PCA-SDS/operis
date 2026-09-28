import { normalizeCustomFieldValue } from '../normalize'

describe('normalizeCustomFieldValue', () => {
  it('keeps primitives and stringifies other values', () => {
    expect(normalizeCustomFieldValue('text')).toBe('text')
    expect(normalizeCustomFieldValue(3)).toBe(3)
    expect(normalizeCustomFieldValue(null)).toBeNull()
    expect(normalizeCustomFieldValue(undefined)).toBeUndefined()
    expect(normalizeCustomFieldValue(new Date('2026-01-01T00:00:00.000Z'))).toBe(String(new Date('2026-01-01T00:00:00.000Z')))
  })

  it('normalizes each entry of an array', () => {
    expect(normalizeCustomFieldValue(['a', 1, { x: 1 }])).toEqual(['a', 1, '[object Object]'])
  })
})
