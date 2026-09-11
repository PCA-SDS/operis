import type { InvoiceSyncJobFailureCategory } from '../../data/entities'

export type GdtProviderErrorKind = 'auth' | 'account_locked' | 'network' | 'provider' | 'invalid_response'

export class GdtProviderError extends Error {
  readonly kind: GdtProviderErrorKind
  readonly cause?: unknown

  constructor(kind: GdtProviderErrorKind, message: string, cause?: unknown) {
    super(`[internal] ${message}`)
    this.name = 'GdtProviderError'
    this.kind = kind
    this.cause = cause
  }
}

export function classifyGdtError(error: unknown): InvoiceSyncJobFailureCategory {
  if (error instanceof GdtProviderError) {
    if (error.kind === 'auth') return 'AUTH_FAILED'
    if (error.kind === 'account_locked') return 'ACCOUNT_LOCKED'
    if (error.kind === 'network' || error.kind === 'provider' || error.kind === 'invalid_response') return 'PORTAL_UNREACHABLE'
  }
  return 'INTERNAL_ERROR'
}
