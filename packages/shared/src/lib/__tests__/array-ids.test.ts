import { arraysEqual } from '../array'
import { stableUuidFromKey } from '../ids'

describe('arraysEqual', () => {
  it('compares element by element, order included', () => {
    expect(arraysEqual(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(arraysEqual(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(arraysEqual(['a'], ['a', 'b'])).toBe(false)
    expect(arraysEqual([], [])).toBe(true)
  })
})

describe('stableUuidFromKey', () => {
  it('is deterministic and UUID-shaped', () => {
    const first = stableUuidFromKey('scheduler:nightly')
    expect(first).toBe(stableUuidFromKey('scheduler:nightly'))
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(first).not.toBe(stableUuidFromKey('scheduler:hourly'))
  })
})
