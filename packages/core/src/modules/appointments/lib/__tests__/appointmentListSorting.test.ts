import { compareAppointmentListRows } from '../appointmentListSorting'

describe('appointment list ordering', () => {
  const row = (
    id: string,
    scheduleConfirmationStatus: 'confirmed' | 'unconfirmed' | 'not_applicable',
    createdAt: string,
    requestedStartAt: string,
  ) => ({ id, scheduleConfirmationStatus, createdAt, requestedStartAt })

  it('keeps pinned bookings first and sorts both groups by newest urgency', () => {
    const rows = [
      row('old-unpinned', 'confirmed', '2026-09-01T08:00:00.000Z', '2026-09-20T08:00:00.000Z'),
      row('new-unpinned', 'confirmed', '2026-09-16T08:00:00.000Z', '2026-09-17T08:00:00.000Z'),
      row('old-pinned', 'unconfirmed', '2026-09-02T08:00:00.000Z', '2026-09-21T08:00:00.000Z'),
      row('new-pinned', 'unconfirmed', '2026-09-15T08:00:00.000Z', '2026-09-16T08:00:00.000Z'),
    ]

    expect(rows.sort(compareAppointmentListRows).map(({ id }) => id)).toEqual([
      'new-pinned',
      'old-pinned',
      'new-unpinned',
      'old-unpinned',
    ])
  })

  it('uses requested start time as a deterministic tie-breaker', () => {
    const olderStart = row('older-start', 'confirmed', '2026-09-16T08:00:00.000Z', '2026-09-17T08:00:00.000Z')
    const laterStart = row('later-start', 'confirmed', '2026-09-16T08:00:00.000Z', '2026-09-18T08:00:00.000Z')

    expect([olderStart, laterStart].sort(compareAppointmentListRows).map(({ id }) => id)).toEqual([
      'later-start',
      'older-start',
    ])
  })
})
