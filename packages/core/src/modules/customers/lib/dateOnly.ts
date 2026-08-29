/**
 * Helpers for `type: 'date'` (date-only) entity columns.
 *
 * MikroORM maps a date column to a `Date` instance, so a raw `YYYY-MM-DD` wire
 * string assigned straight onto the property fails at flush time. Reads are the
 * mirror problem: a `Date` serialises to a full ISO timestamp, which an
 * `<input type="date">` refuses. Both directions go through here so every call
 * site agrees, matching the pattern in `staff/commands/timesheets-projects.ts`.
 */

export function toDateOnlyValue(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function toDateOnlyString(value: string | Date | null | undefined): string | null {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().split('T')[0]
  }
  return value.length >= 10 ? value.slice(0, 10) : value
}

export function todayDateOnly(): Date {
  return toDateOnlyValue(new Date().toISOString().split('T')[0]) as Date
}
