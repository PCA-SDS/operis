/** Queue names owned by this module. */
export const CHAT_MATRIX_QUEUES = {
  driftCheck: 'chat-matrix-drift-check',
  /**
   * The `/sync` reader. One job per tick, concurrency 1 — a second reader would
   * advance the shared cursor past events the first had not projected.
   */
  sync: 'chat-matrix-sync',
} as const

/**
 * How often the shadow phase asks whether Matrix is keeping up.
 *
 * Fifteen minutes rather than a minute: drift is a condition that persists until
 * somebody runs the backfill, so checking more often produces the same answer
 * more expensively. Fifteen minutes still bounds how long a broken publish path
 * goes unnoticed to well inside a working day.
 */
export const DRIFT_CHECK_INTERVAL_SECONDS = 900

/**
 * How often the loop asks the homeserver what is new.
 *
 * Five seconds, because in authoritative mode this is the path an event Operis
 * did not send takes to reach a reader — recovery of a message whose commit
 * failed today, and every bridged message once one is attached. The `/sync`
 * long-poll does the waiting server-side, so a short cadence costs a held
 * connection rather than repeated work.
 */
export const SYNC_INTERVAL_SECONDS = 5

/** The single appservice stream. Named so a second reader can have its own cursor. */
export const DEFAULT_SYNC_STREAM = 'default'
