export function hasHttpStatus(error: unknown, status: number): boolean {
  return Boolean(error && typeof error === 'object' && (error as { status?: unknown }).status === status)
}
