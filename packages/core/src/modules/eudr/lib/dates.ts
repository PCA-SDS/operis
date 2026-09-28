export const DAY_MS = 24 * 60 * 60 * 1000

export function daysLeft(deadline: string, now: Date): number {
  const deadlineDate = new Date(`${deadline}T00:00:00.000Z`)
  return Math.ceil((deadlineDate.getTime() - now.getTime()) / DAY_MS)
}

export function isOverdue(value: string | null | undefined): boolean {
  if (!value) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now()
}

export function toDateTimeLocalInput(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}
