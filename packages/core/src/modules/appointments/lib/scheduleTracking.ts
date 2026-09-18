export const SCHEDULE_TRACKING_SINCE = new Date('2026-07-31T17:00:00.000Z')

export type ScheduleConfirmationStatus = 'confirmed' | 'unconfirmed' | 'not_applicable'

export function deriveScheduleConfirmationStatus(input: {
  createdAt: Date
  confirmedAllocationCount: number
  statusCode: string | null | undefined
}): ScheduleConfirmationStatus {
  if (input.confirmedAllocationCount > 0) return 'confirmed'
  if (input.statusCode === 'cancelled') return 'not_applicable'
  if (input.createdAt < SCHEDULE_TRACKING_SINCE) return 'not_applicable'
  return 'unconfirmed'
}

export function isActionableUnconfirmed(input: {
  createdAt: Date
  confirmedAllocationCount: number
  statusCode: string | null | undefined
}) {
  return deriveScheduleConfirmationStatus(input) === 'unconfirmed'
}

