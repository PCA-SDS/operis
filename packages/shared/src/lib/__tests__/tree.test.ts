import { formatTreeLabel } from '../tree'

describe('formatTreeLabel', () => {
  it('returns plain name for depth 0', () => {
    expect(formatTreeLabel('Electronics', 0)).toBe('Electronics')
  })

  it('returns arrow-prefixed name for depth 1', () => {
    expect(formatTreeLabel('Phones', 1)).toBe('↳ Phones')
  })

  it('returns indented arrow-prefixed name for depth 2', () => {
    const result = formatTreeLabel('Smartphones', 2)
    expect(result).toBe('\u00A0\u00A0↳ Smartphones')
  })

  it('increases indentation for deeper levels', () => {
    const result = formatTreeLabel('Cases', 3)
    expect(result).toBe('\u00A0\u00A0\u00A0\u00A0↳ Cases')
  })

  it('returns plain name for negative depth', () => {
    expect(formatTreeLabel('Root', -1)).toBe('Root')
  })
})
