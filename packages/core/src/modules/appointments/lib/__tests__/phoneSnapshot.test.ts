/** @jest-environment node */

import { formatCustomerPhone, toAppointmentPhoneSnapshot } from '../phoneSnapshot'

describe('toAppointmentPhoneSnapshot', () => {
  it('splits full international phone into Privé dial + national parts', () => {
    expect(toAppointmentPhoneSnapshot('+84 842722728', '84')).toEqual({
      customerPhone: '842722728',
      customerPhoneCountryCode: '+84',
    })
    expect(toAppointmentPhoneSnapshot('+84 842722728', '+84')).toEqual({
      customerPhone: '842722728',
      customerPhoneCountryCode: '+84',
    })
  })

  it('keeps national phone when dial is already separate', () => {
    expect(toAppointmentPhoneSnapshot('842722728', '+84')).toEqual({
      customerPhone: '842722728',
      customerPhoneCountryCode: '+84',
    })
  })

  it('returns null for blank phone', () => {
    expect(toAppointmentPhoneSnapshot('  ', '+84')).toBeNull()
    expect(toAppointmentPhoneSnapshot(null, '+84')).toBeNull()
  })
})

describe('formatCustomerPhone', () => {
  it('joins Privé-style dial + national', () => {
    expect(formatCustomerPhone('+84', '842722728')).toBe('+84 842722728')
    expect(formatCustomerPhone('84', '842722728')).toBe('+84 842722728')
  })

  it('does not duplicate dial on legacy full-phone snapshots', () => {
    expect(formatCustomerPhone('84', '+84 842722728')).toBe('+84 842722728')
    expect(formatCustomerPhone('+84', '+84 842722728')).toBe('+84 842722728')
  })

  it('handles missing parts', () => {
    expect(formatCustomerPhone(null, '912345678')).toBe('912345678')
    expect(formatCustomerPhone('+84', null)).toBe('')
    expect(formatCustomerPhone(null, null)).toBe('')
  })
})
