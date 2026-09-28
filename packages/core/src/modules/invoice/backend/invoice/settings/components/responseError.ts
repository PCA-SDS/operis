export type ErrorResponse = { error?: string }

export function responseError(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && 'error' in value && typeof (value as ErrorResponse).error === 'string') {
    return (value as ErrorResponse).error || fallback
  }
  return fallback
}
