export function isValidDateString(value: string): boolean {
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime())
}
