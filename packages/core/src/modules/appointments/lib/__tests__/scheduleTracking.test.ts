import {
  deriveScheduleConfirmationStatus,
  isActionableUnconfirmed,
  SCHEDULE_TRACKING_SINCE,
} from '../scheduleTracking'

describe('schedule tracking', () => {
  const currentBooking = {
    createdAt: new Date(SCHEDULE_TRACKING_SINCE.getTime() + 60_000),
    statusCode: 'new_request',
  }

  it('pins a current booking without a confirmed allocation', () => {
    expect(deriveScheduleConfirmationStatus({ ...currentBooking, confirmedAllocationCount: 0 })).toBe('unconfirmed')
    expect(isActionableUnconfirmed({ ...currentBooking, confirmedAllocationCount: 0 })).toBe(true)
  })

  it('does not pin confirmed, cancelled, or legacy bookings', () => {
    expect(deriveScheduleConfirmationStatus({ ...currentBooking, confirmedAllocationCount: 1 })).toBe('confirmed')
    expect(deriveScheduleConfirmationStatus({ ...currentBooking, statusCode: 'cancelled', confirmedAllocationCount: 0 })).toBe('not_applicable')
    expect(deriveScheduleConfirmationStatus({ createdAt: new Date(SCHEDULE_TRACKING_SINCE.getTime() - 1), statusCode: 'new_request', confirmedAllocationCount: 0 })).toBe('not_applicable')
  })
})
