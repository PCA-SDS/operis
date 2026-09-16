export const APPOINTMENT_NEW_REQUEST_SLA_MS = 15 * 60 * 1000

const ARRIVAL_HIDDEN_STATUS_CODES = new Set(['cancelled', 'completed', 'no_show'])

export type TimeAgoParts =
  | { kind: 'just_now' }
  | { kind: 'minutes'; count: number }
  | { kind: 'hours'; count: number }
  | { kind: 'days'; count: number }

export function isAppointmentOverdue(
  statusCode: string,
  createdAt: string | Date,
  now: number = Date.now(),
): boolean {
  if (statusCode !== 'new_request') return false
  const created = new Date(createdAt).getTime()
  if (Number.isNaN(created)) return false
  return now - created > APPOINTMENT_NEW_REQUEST_SLA_MS
}

export function getTimeAgoParts(createdAt: string | Date, now: number = Date.now()): TimeAgoParts | null {
  const created = new Date(createdAt).getTime()
  if (Number.isNaN(created)) return null
  const diffMs = Math.max(0, now - created)
  const diffMins = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  if (diffMins < 1) return { kind: 'just_now' }
  if (diffMins < 60) return { kind: 'minutes', count: diffMins }
  if (diffHours < 24) return { kind: 'hours', count: diffHours }
  return { kind: 'days', count: diffDays }
}

export function shouldShowArrivalInfo(statusCode: string): boolean {
  return !ARRIVAL_HIDDEN_STATUS_CODES.has(statusCode)
}
