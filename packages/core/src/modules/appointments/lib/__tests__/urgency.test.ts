/** @jest-environment node */

import {
  getTimeAgoParts,
  isAppointmentOverdue,
  shouldShowArrivalInfo,
  APPOINTMENT_NEW_REQUEST_SLA_MS,
} from '../urgency'

describe('urgency helpers', () => {
  const now = Date.parse('2026-08-26T10:00:00.000Z')

  it('marks new_request overdue after SLA', () => {
    const createdAt = new Date(now - APPOINTMENT_NEW_REQUEST_SLA_MS - 1).toISOString()
    expect(isAppointmentOverdue('new_request', createdAt, now)).toBe(true)
    expect(isAppointmentOverdue('booked', createdAt, now)).toBe(false)
  })

  it('formats time-ago buckets', () => {
    expect(getTimeAgoParts(new Date(now - 30_000).toISOString(), now)).toEqual({ kind: 'just_now' })
    expect(getTimeAgoParts(new Date(now - 5 * 60_000).toISOString(), now)).toEqual({
      kind: 'minutes',
      count: 5,
    })
    expect(getTimeAgoParts(new Date(now - 3 * 60 * 60_000).toISOString(), now)).toEqual({
      kind: 'hours',
      count: 3,
    })
    expect(getTimeAgoParts(new Date(now - 2 * 24 * 60 * 60_000).toISOString(), now)).toEqual({
      kind: 'days',
      count: 2,
    })
  })

  it('hides arrival for terminal statuses', () => {
    expect(shouldShowArrivalInfo('new_request')).toBe(true)
    expect(shouldShowArrivalInfo('cancelled')).toBe(false)
    expect(shouldShowArrivalInfo('completed')).toBe(false)
  })
})
