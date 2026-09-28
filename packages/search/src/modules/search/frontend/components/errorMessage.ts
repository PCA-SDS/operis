export const normalizeErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'string' && error.trim().length) return error.trim()
  if (error instanceof Error && error.message.trim().length) return error.message.trim()
  return fallback
}
