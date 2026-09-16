export function localDate(value: Date | string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

export function addCalendarMonths(value: string, months: number): string {
  const date = new Date(`${value}T00:00:00`)
  const day = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + months)
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(day, lastDay))
  return localDate(date)
}

export type IssuedRange = 'yesterday' | 'lastWeek' | 'last7Days' | 'lastMonth' | 'last3Months' | 'last12Months'

export function issuedRange(range: IssuedRange, today = new Date()): [string, string] {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const end = new Date(start)
  if (range === 'yesterday') {
    start.setDate(start.getDate() - 1)
    end.setDate(end.getDate() - 1)
  } else if (range === 'lastWeek') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7)
    end.setTime(start.getTime())
    end.setDate(end.getDate() + 6)
  } else if (range === 'last7Days') {
    start.setDate(start.getDate() - 6)
  } else {
    const months = range === 'lastMonth' ? 1 : range === 'last3Months' ? 3 : 12
    start.setDate(1)
    start.setMonth(start.getMonth() - months)
    end.setDate(0)
  }
  return [localDate(start), localDate(end)]
}
