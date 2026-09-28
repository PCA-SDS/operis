export type AvailabilityRepeat = 'once' | 'daily' | 'weekly'

export type AvailabilityRuleWindow = {
  startAt: Date
  endAt: Date
  repeat: AvailabilityRepeat
}

export type AvailabilityRuleLike = {
  id: string
  rrule: string
  createdAt?: string | Date | null
  kind?: 'availability' | 'unavailability'
  note?: string | null
  exdates?: string[]
}

export function parseAvailabilityRuleWindow(rule: AvailabilityRuleLike): AvailabilityRuleWindow {
  const dtStartMatch = rule.rrule.match(/DTSTART[:=](\d{8}T\d{6}Z?)/)
  const durationMatch = rule.rrule.match(/DURATION:PT(?:(\d+)H)?(?:(\d+)M)?/)
  const freqMatch = rule.rrule.match(/FREQ=([A-Z]+)/)
  const countMatch = rule.rrule.match(/COUNT=(\d+)/)
  let start = new Date()
  if (dtStartMatch?.[1]) {
    const raw = dtStartMatch[1].replace(/Z$/, '')
    const parts = raw.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/)
    if (parts) {
      const [, year, month, day, hour, minute, second] = parts
      const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
      const parsed = new Date(iso)
      if (!Number.isNaN(parsed.getTime())) start = parsed
    }
  } else if (rule.createdAt) {
    const parsed = rule.createdAt instanceof Date ? rule.createdAt : new Date(rule.createdAt)
    if (!Number.isNaN(parsed.getTime())) start = parsed
  }
  let durationMinutes = 60
  if (durationMatch) {
    const hours = durationMatch[1] ? Number(durationMatch[1]) : 0
    const minutes = durationMatch[2] ? Number(durationMatch[2]) : 0
    durationMinutes = Math.max(1, hours * 60 + minutes)
  }
  const end = new Date(start.getTime() + durationMinutes * 60000)
  const freq = freqMatch?.[1]
  const repeat: AvailabilityRepeat =
    freq === 'WEEKLY'
      ? 'weekly'
      : freq === 'DAILY' && countMatch?.[1] === '1'
        ? 'once'
        : freq === 'DAILY'
          ? 'daily'
          : 'once'
  return { startAt: start, endAt: end, repeat }
}

export function parseTimeInput(value: string): { hours: number; minutes: number } | null {
  const [hours, minutes] = value.split(':').map((part) => Number(part))
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return { hours, minutes }
}

export function toDateForWeekday(weekday: number, time: string): Date | null {
  const parsed = parseTimeInput(time)
  if (!parsed) return null
  const now = new Date()
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = (weekday - base.getDay() + 7) % 7
  const target = new Date(base.getTime() + diff * 24 * 60 * 60 * 1000)
  target.setHours(parsed.hours, parsed.minutes, 0, 0)
  return target
}

export function parseAcceptanceMinutes(value?: string | null): number | null {
  if (!value) return null
  const parsed = parseTimeInput(value)
  return parsed ? parsed.hours * 60 + parsed.minutes : null
}

export function formatDuration(minutes: number): string {
  const clamped = Math.max(1, minutes)
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  if (hours > 0 && mins > 0) return `PT${hours}H${mins}M`
  if (hours > 0) return `PT${hours}H`
  return `PT${mins}M`
}

export function buildAvailabilityRrule(start: Date, end: Date): string {
  const dtStart = start.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
  const duration = formatDuration(durationMinutes)
  return `DTSTART:${dtStart}\nDURATION:${duration}\nRRULE:FREQ=DAILY;COUNT=1`
}

export const DAY_MS = 24 * 60 * 60 * 1000

export function toFullDayWindow(value: Date): { start: Date; end: Date } {
  const start = new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const end = new Date(start.getTime() + DAY_MS)
  return { start, end }
}
