import { hasMemberUnavailabilityOverlap } from '../seatPlannerService'

describe('hasMemberUnavailabilityOverlap', () => {
  const rule = {
    id: 'rule-1',
    kind: 'unavailability' as const,
    exdates: [],
    rrule: 'DTSTART:20260923T000000Z\nDURATION:PT24H\nRRULE:FREQ=DAILY;COUNT=1',
  }

  it('blocks an appointment inside an approved full-day leave rule', () => {
    expect(hasMemberUnavailabilityOverlap(
      [rule],
      new Date('2026-09-23T02:00:00.000Z'),
      new Date('2026-09-23T02:30:00.000Z'),
    )).toBe(true)
  })

  it('does not block an appointment outside the leave date', () => {
    expect(hasMemberUnavailabilityOverlap(
      [rule],
      new Date('2026-09-24T02:00:00.000Z'),
      new Date('2026-09-24T02:30:00.000Z'),
    )).toBe(false)
  })
})
