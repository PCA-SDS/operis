import {
  appointmentStatusCodeFromLabel,
  isAppointmentSystemStatusCode,
  isValidAppointmentStatusCode,
  normalizeAppointmentStatusCode,
} from '../statusCatalog'

describe('appointment status catalog helpers', () => {
  it('slugifies labels into snake_case codes', () => {
    expect(appointmentStatusCodeFromLabel('Deposit Received')).toBe('deposit_received')
    expect(appointmentStatusCodeFromLabel('  Waiting List!! ')).toBe('waiting_list')
  })

  it('validates code shape', () => {
    expect(isValidAppointmentStatusCode('new_request')).toBe(true)
    expect(isValidAppointmentStatusCode('1bad')).toBe(false)
    expect(isValidAppointmentStatusCode('Bad-Code')).toBe(false)
  })

  it('reserves system codes', () => {
    expect(isAppointmentSystemStatusCode('new_request')).toBe(true)
    expect(isAppointmentSystemStatusCode('cancelled')).toBe(true)
    expect(isAppointmentSystemStatusCode('custom_stage')).toBe(false)
  })

  it('prefers explicit code over label slug', () => {
    expect(normalizeAppointmentStatusCode('vip_hold', 'VIP Hold')).toBe('vip_hold')
    expect(normalizeAppointmentStatusCode('', 'VIP Hold')).toBe('vip_hold')
  })
})
