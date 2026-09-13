/**
 * Failure taxonomy for Matrix calls.
 *
 * The distinction that matters to callers is not "what went wrong" but "what
 * should happen next", so every failure is classified into one of three kinds
 * before it leaves this package. A caller that has to parse an error message to
 * decide whether to retry will eventually parse it wrong.
 */

/**
 * - `transient` — retry with backoff. Network failures, timeouts, 429, 5xx.
 * - `reauth` — the credential is no longer valid. Retrying cannot help; a human
 *   has to rotate the appservice token.
 * - `permanent` — the request itself is wrong. Retrying re-sends the same wrong
 *   request forever, which is how a poison message stalls a queue.
 */
export type MatrixFailureKind = 'transient' | 'reauth' | 'permanent'

export type MatrixErrorInit = {
  message: string
  kind: MatrixFailureKind
  status: number
  errcode?: string
  retryAfterMs?: number
  cause?: unknown
}

export class MatrixError extends Error {
  readonly kind: MatrixFailureKind
  /** HTTP status, or 0 when the request never produced a response. */
  readonly status: number
  /** Matrix error code such as `M_FORBIDDEN`, when the homeserver supplied one. */
  readonly errcode?: string
  /** Honour this before retrying a `transient` failure, when present. */
  readonly retryAfterMs?: number

  constructor(init: MatrixErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'MatrixError'
    this.kind = init.kind
    this.status = init.status
    this.errcode = init.errcode
    this.retryAfterMs = init.retryAfterMs
  }

  get isTransient(): boolean {
    return this.kind === 'transient'
  }

  get isReauth(): boolean {
    return this.kind === 'reauth'
  }

  get isPermanent(): boolean {
    return this.kind === 'permanent'
  }
}

/** Configuration was rejected before any request was attempted. */
export class MatrixConfigError extends Error {
  readonly field?: string

  constructor(message: string, field?: string) {
    super(message)
    this.name = 'MatrixConfigError'
    this.field = field
  }
}

/**
 * An attempt to act as a Matrix user this appservice does not own.
 *
 * This is a security control rather than a validation nicety: the appservice
 * token can masquerade as any user inside its registered namespace, so a bug in
 * identity derivation that escaped the namespace would let Operis act as an
 * arbitrary homeserver account.
 */
export class MatrixNamespaceError extends Error {
  readonly userId: string

  constructor(message: string, userId: string) {
    super(message)
    this.name = 'MatrixNamespaceError'
    this.userId = userId
  }
}

/**
 * Matrix error codes that mean the credential itself is finished.
 *
 * `M_FORBIDDEN` is deliberately absent: the homeserver returns it both for "your
 * token is bad" and for "this user may not do that", and treating an ordinary
 * permission refusal as a credential failure would flip a whole channel into a
 * reauth state because one user lacked power level.
 */
const REAUTH_ERRCODES = new Set(['M_UNKNOWN_TOKEN', 'M_MISSING_TOKEN', 'M_USER_DEACTIVATED'])

export function classifyMatrixFailure(status: number, errcode?: string): MatrixFailureKind {
  if (errcode && REAUTH_ERRCODES.has(errcode)) return 'reauth'
  if (status === 429) return 'transient'
  // 0 is this package's marker for "no response at all" — DNS failure, connection
  // refused, timeout. Always worth retrying.
  if (status === 0) return 'transient'
  if (status >= 500) return 'transient'
  return 'permanent'
}

export function isMatrixError(error: unknown): error is MatrixError {
  return error instanceof MatrixError
}
