/** @jest-environment node */

import { buildFullDayRrule } from '../availability-date-specific'

describe('buildFullDayRrule', () => {
  it('stores local midnight in UTC for the selected timezone', () => {
    expect(buildFullDayRrule('2026-09-18', 'Asia/Ho_Chi_Minh')).toBe(
      'DTSTART:20260917T170000Z\nDURATION:PT24H\nRRULE:FREQ=DAILY;COUNT=1',
    )
  })

  it('keeps the full local calendar day across daylight-saving changes', () => {
    expect(buildFullDayRrule('2026-11-01', 'America/New_York')).toBe(
      'DTSTART:20261101T040000Z\nDURATION:PT25H\nRRULE:FREQ=DAILY;COUNT=1',
    )
  })
})
