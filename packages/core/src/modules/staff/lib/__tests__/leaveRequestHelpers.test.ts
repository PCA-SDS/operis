/**
 * @jest-environment node
 */
import { resolveStatusVariant, formatDateRange } from '../leaveRequestHelpers'

describe('leaveRequestHelpers', () => {
  describe('resolveStatusVariant', () => {
    it('returns default for approved', () => {
      expect(resolveStatusVariant('approved')).toBe('default')
    })

    it('returns destructive for rejected', () => {
      expect(resolveStatusVariant('rejected')).toBe('destructive')
    })

    it('returns secondary for pending', () => {
      expect(resolveStatusVariant('pending')).toBe('secondary')
    })

    it('returns secondary for unknown status', () => {
      expect(resolveStatusVariant('unknown' as 'pending')).toBe('secondary')
    })
  })

  describe('formatDateRange', () => {
    it('returns "start -> end" when both dates provided', () => {
      const result = formatDateRange('2025-06-01', '2025-06-15')
      expect(result).toContain('->')
    })

    it('returns just start when only start provided', () => {
      const result = formatDateRange('2025-06-01', null)
      expect(result).toBeTruthy()
      expect(result).not.toContain('->')
      expect(result).not.toBe('-')
    })

    it('returns just end when only end provided', () => {
      const result = formatDateRange(null, '2025-06-15')
      expect(result).toBeTruthy()
      expect(result).not.toContain('->')
      expect(result).not.toBe('-')
    })

    it('returns dash when neither provided', () => {
      expect(formatDateRange(null, null)).toBe('-')
    })
  })
})
