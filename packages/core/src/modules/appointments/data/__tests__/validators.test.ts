/** @jest-environment node */

import { appointmentStaffCreateSchema } from '../../data/validators'

describe('appointmentStaffCreateSchema', () => {
  const base = {
    requestedStartAt: '2026-09-01T10:00:00.000Z',
    bookingType: 'walk_in',
    customer: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '5551212',
      source: 'linkedin',
      origin: 'local',
      phoneCountryCode: '+84',
    },
    lines: [{ productId: '11111111-1111-4111-8111-111111111111' }],
  }

  it('accepts TPS parity payload', () => {
    const parsed = appointmentStaffCreateSchema.parse({
      ...base,
      externalNotes: 'Bring towel',
      organizationId: '33333333-3333-4333-8333-333333333333',
    })
    expect(parsed.customer.origin).toBe('local')
    expect(parsed.bookingType).toBe('walk_in')
    expect(parsed.customer.source).toBe('linkedin')
    expect(parsed.externalNotes).toBe('Bring towel')
  })

  it('accepts any CRM dictionary source string', () => {
    const parsed = appointmentStaffCreateSchema.parse({
      ...base,
      customer: { ...base.customer, source: 'cold_outreach' },
    })
    expect(parsed.customer.source).toBe('cold_outreach')
  })

  it('rejects missing referral source', () => {
    const result = appointmentStaffCreateSchema.safeParse({
      ...base,
      customer: { ...base.customer, source: undefined },
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid origin', () => {
    const result = appointmentStaffCreateSchema.safeParse({
      ...base,
      customer: { ...base.customer, origin: 'unknown' },
    })
    expect(result.success).toBe(false)
  })
})
