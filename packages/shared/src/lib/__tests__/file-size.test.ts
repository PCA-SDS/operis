import { formatFileSize } from '../units/fileSize'

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1500, '1.5 KB'],
    [2048, '2.0 KB'],
    [1024 * 1024 * 3.5, '3.5 MB'],
    [1024 * 1024 * 1024 * 2, '2.0 GB'],
    [1024 ** 4 * 3, '3.0 TB'],
  ])('renders %i bytes as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected)
  })

  it('renders an em dash rather than NaN B for a non-finite size', () => {
    // Two of the five copies this replaced rendered the literal string "NaN B".
    expect(formatFileSize(Number.NaN)).toBe('—')
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('stops at the largest known unit rather than inventing one', () => {
    expect(formatFileSize(1024 ** 6)).toContain('TB')
  })
})
