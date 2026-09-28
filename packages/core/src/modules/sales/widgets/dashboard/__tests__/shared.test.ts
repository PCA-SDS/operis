/**
 * @jest-environment node
 */
import type React from 'react'
import { readString, toDateInputValue, openNativeDatePicker } from '../shared'

describe('sales dashboard shared helpers', () => {
  describe('readString', () => {
    it('returns string value as-is', () => {
      expect(readString('hello')).toBe('hello')
    })

    it('returns null for a number', () => {
      expect(readString(42)).toBeNull()
    })

    it('returns null for null', () => {
      expect(readString(null)).toBeNull()
    })

    it('returns null for undefined', () => {
      expect(readString(undefined)).toBeNull()
    })

    it('returns null for an object', () => {
      expect(readString({ key: 'value' })).toBeNull()
    })
  })

  describe('toDateInputValue', () => {
    it('returns empty string for null', () => {
      expect(toDateInputValue(null)).toBe('')
    })

    it('returns empty string for undefined', () => {
      expect(toDateInputValue(undefined)).toBe('')
    })

    it('returns empty string for empty string', () => {
      expect(toDateInputValue('')).toBe('')
    })

    it('returns YYYY-MM-DD for a valid date string', () => {
      const result = toDateInputValue('2025-03-15T10:00:00Z')
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('returns empty string for an invalid date string', () => {
      expect(toDateInputValue('not-a-date')).toBe('')
    })
  })

  describe('openNativeDatePicker', () => {
    it('calls showPicker when available', () => {
      const showPicker = jest.fn()
      const event = { currentTarget: { showPicker } } as unknown as React.SyntheticEvent<HTMLInputElement>
      openNativeDatePicker(event)
      expect(showPicker).toHaveBeenCalledTimes(1)
    })

    it('does nothing when showPicker is not available', () => {
      const event = { currentTarget: {} } as unknown as React.SyntheticEvent<HTMLInputElement>
      expect(() => openNativeDatePicker(event)).not.toThrow()
    })
  })
})
