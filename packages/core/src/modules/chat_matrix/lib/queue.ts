/** Queue names owned by this module. */
export const CHAT_MATRIX_QUEUES = {
  driftCheck: 'chat-matrix-drift-check',
  /**
   * The `/sync` reader. One job per tick, concurrency 1 — a second reader would
   * advance the shared cursor past events the first had not projected.
   */
  sync: 'chat-matrix-sync',
  /**
   * Transactions the homeserver pushed. One at a time, in the order they
   * arrived — Synapse delivers appservice transactions **in order** and a
   * reaction whose message has not projected yet is a reaction that is lost.
   */
  appserviceTransaction: 'chat-matrix-appservice-transaction',
  /**
   * Messaging account logins in progress. Each job holds a long-poll on the
   * bridge while a QR code is on somebody's screen, so several run at once —
   * one account's login must not wait behind another's.
   */
  accountLogin: 'chat-matrix-account-login',
} as const

/** How many logins can be waited on at once, per worker. */
export const ACCOUNT_LOGIN_CONCURRENCY = 10

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

/**
 * Whether the homeserver pushes transactions to us, or we poll for them.
 *
 * Set `OM_MATRIX_APPSERVICE_URL` to the base URL Synapse can reach Operis at —
 * the registration then carries it and the homeserver PUTs each transaction
 * instead of leaving them to be discovered on the next poll.
 *
 * **Push does not replace the poll, and that is deliberate.** An appservice
 * transaction has no cursor: one that fails while Operis is down is retried by
 * Synapse for a while and then dropped, with nothing left to say it existed.
 * The `/sync` reader keeps its own cursor and finds anything push missed, and
 * because projection is idempotent on `event_id` the two costs nothing but a
 * parked long-poll. Push buys latency; the poll remains the thing that
 * guarantees delivery.
 */
export function resolveAppserviceUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.OM_MATRIX_APPSERVICE_URL
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  return raw.trim().replace(/\/+$/, '')
}

/**
 * The appservice's base address, as the registration wants it.
 *
 * NOT the transactions path: a homeserver appends `/_matrix/app/v1/transactions/
 * {txnId}` to whatever `url` says, so naming the endpoint here produces a PUT
 * with the segment in it twice and a 404 on every push.
 */
export function appserviceBaseUrl(base: string): string {
  return `${base}/api/chat_matrix/appservice`
}

// ---------------------------------------------------------------------------
// The pushed-transaction queue.
//
// Its own module-level handle rather than a DI registration: the endpoint that
// enqueues is unauthenticated and deliberately does as little as possible, and
// building a request container to reach a queue would be work on the one path
// that must not do any.
// ---------------------------------------------------------------------------

import { createModuleQueue, type Queue } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'

export type AppserviceTransactionJob = {
  txnId: string
  events: unknown[]
  ephemeral: unknown[]
}

let appserviceQueue: Queue<AppserviceTransactionJob> | null = null

export function getAppserviceQueue(): Queue<AppserviceTransactionJob> {
  if (appserviceQueue) return appserviceQueue
  // Concurrency 1, because Synapse delivers in order and a relation whose
  // target is still in the previous job is a relation that is lost.
  appserviceQueue = createModuleQueue<AppserviceTransactionJob>(
    CHAT_MATRIX_QUEUES.appserviceTransaction,
    { concurrency: 1 },
  )
  return appserviceQueue
}

/**
 * Enqueue a pushed transaction for the auto-discovered worker.
 *
 * Nothing here consumes the queue. Every strategy already has exactly one
 * consumer for it: BullMQ workers in `async` mode, and in `local` mode the
 * worker process the lazy supervisor spawns as soon as a job is pending (the
 * default dev and QA topology). A second, in-process consumer used to be
 * started here; the local strategy has no per-job lease, so two consumers
 * processed the same transactions twice and — worse — out of order, which is
 * exactly what `concurrency: 1` exists to prevent.
 */
export async function enqueueAppserviceTransaction(job: AppserviceTransactionJob): Promise<void> {
  await getAppserviceQueue().enqueue(job)
}

export type { EntityManager as ChatMatrixEntityManager }

// ---------------------------------------------------------------------------
// The account-login queue: one job per login attempt, waiting on the bridge.
// ---------------------------------------------------------------------------

export type AccountLoginJob = {
  tenantId: string
  organizationId: string
  accountId: string
  /** Chat's attempt id. A job whose attempt is no longer current stops at once. */
  attemptId: string
}

let accountLoginQueue: Queue<AccountLoginJob> | null = null

export function getAccountLoginQueue(): Queue<AccountLoginJob> {
  if (accountLoginQueue) return accountLoginQueue
  accountLoginQueue = createModuleQueue<AccountLoginJob>(CHAT_MATRIX_QUEUES.accountLogin, {
    concurrency: ACCOUNT_LOGIN_CONCURRENCY,
  })
  return accountLoginQueue
}

/**
 * Hand a login to the worker. Like the transaction queue, nothing in the app
 * process consumes it — the queue's one worker does. With the `local` strategy
 * that worker runs jobs one at a time, so in development a second login waits
 * for the first to finish; production's `async` workers run several at once.
 */
export async function enqueueAccountLogin(job: AccountLoginJob): Promise<void> {
  await getAccountLoginQueue().enqueue(job)
}
