/**
 * Detect a Postgres unique-constraint violation (SQLSTATE 23505) regardless of
 * the ORM/driver layer that surfaces it. Shared across modules so duplicate-insert
 * handling stays consistent platform-wide.
 */
/** SQLSTATE for `unique_violation`. */
export const POSTGRES_UNIQUE_VIOLATION = '23505'

const UNIQUE_VIOLATION_MESSAGE = /duplicate key value|unique constraint|duplicate key/i

/**
 * ORMs and drivers each wrap the driver error differently — MikroORM nests it
 * under `previous`, some paths under `cause`, others under `driverError`. Walk
 * the chain rather than checking one shape.
 */
const WRAPPER_KEYS = ['cause', 'previous', 'driverError', 'originalError'] as const

/**
 * Detect a Postgres unique-constraint violation (SQLSTATE 23505) through
 * whatever wrapper surfaced it, optionally narrowing to one constraint.
 *
 * Twelve modules had each hand-rolled a different subset of this check — some
 * only the top-level `code`, some only the ORM exception class, some only a
 * message match. Each therefore missed violations the others caught, and a miss
 * means the caller's duplicate-handling path is skipped and the request fails as
 * an unexpected 500 instead.
 */
export type UniqueViolationOptions = {
  /**
   * Also treat an error whose *message* mentions a duplicate key as a violation,
   * for drivers that drop the SQLSTATE.
   *
   * Off by default, deliberately: the message is not authoritative, and matching
   * on it misclassifies any unrelated failure that happens to quote a constraint
   * — which is exactly how a "don't leak internal errors" path started answering
   * 409 instead of 500.
   */
  matchMessage?: boolean
}

export function isUniqueViolation(
  err: unknown,
  constraintName?: string,
  options: UniqueViolationOptions = {},
): boolean {
  const seen = new Set<unknown>()

  const matchesConstraint = (record: Record<string, unknown>): boolean => {
    if (!constraintName) return true
    const constraint = typeof record.constraint === 'string' ? record.constraint : ''
    const detail = typeof record.detail === 'string' ? record.detail : ''
    const message = typeof record.message === 'string' ? record.message : ''
    return (
      constraint === constraintName ||
      detail.includes(constraintName) ||
      message.includes(constraintName)
    )
  }

  const inspect = (value: unknown, depth: number): boolean => {
    if (depth > 5 || !value || typeof value !== 'object' || seen.has(value)) return false
    seen.add(value)
    const record = value as Record<string, unknown>

    if (record.code === POSTGRES_UNIQUE_VIOLATION || record.sqlState === POSTGRES_UNIQUE_VIOLATION) {
      if (matchesConstraint(record)) return true
    }
    // MikroORM's `UniqueConstraintViolationException` keeps the SQLSTATE on the
    // wrapped driver error, so it is reached by the walk below rather than by a
    // class check — which also avoids importing the ORM into this helper.
    if (typeof record.name === 'string' && record.name === 'UniqueConstraintViolationException') {
      if (matchesConstraint(record)) return true
    }
    if (options.matchMessage && !constraintName) {
      const message = typeof record.message === 'string' ? record.message : ''
      if (message && UNIQUE_VIOLATION_MESSAGE.test(message)) return true
    }

    return WRAPPER_KEYS.some((key) => inspect(record[key], depth + 1))
  }

  return inspect(err, 0)
}

/**
 * Postgres SQLSTATEs for transient connection / availability failures — the
 * database (or its connection pool) is temporarily unreachable and the request
 * can succeed on retry. Deliberately scoped to connection/availability codes;
 * query-level conflicts (deadlock 40P01, serialization 40001, lock_not_available
 * 55P03) are NOT included because they do not mean "service unavailable".
 */
const TRANSIENT_CONNECTION_SQLSTATES = new Set([
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (db starting up)
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08006', // connection_failure
])

/**
 * Postgres-driver / connection-pool messages that describe a transient DB
 * connection failure when the SQLSTATE is dropped by the ORM wrapper. These are
 * intentionally DB-specific phrases only. Bare socket codes (ECONNREFUSED,
 * ETIMEDOUT, …) are deliberately NOT matched: they can originate from any
 * outbound socket (HTTP, cache, queue), so keying off them would falsely
 * attribute unrelated failures to the database.
 */
const TRANSIENT_DB_MESSAGE_PATTERNS = [
  /too many clients already/i,
  /unable to acquire a connection/i,
  /timeout acquiring a connection/i,
  /connection terminated/i,
  /the database system is (starting up|shutting down|in recovery)/i,
]

/**
 * Detect a transient Postgres connection / availability failure (pool exhaustion,
 * `max_connections` reached, DB restarting) via its SQLSTATE or a DB-specific
 * driver message. Gates retryable 503 responses so callers do not report a
 * temporary infrastructure blip as an auth failure (401) or an unexpected server
 * error (500). Scoped to unambiguous DB signals so generic socket errors from
 * non-DB calls are never misclassified.
 */
export function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false
  }
  const code = (err as { code?: string }).code
  if (typeof code === 'string' && TRANSIENT_CONNECTION_SQLSTATES.has(code)) {
    return true
  }
  const message = (err as { message?: string }).message
  if (typeof message === 'string' && TRANSIENT_DB_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return true
  }
  return false
}
