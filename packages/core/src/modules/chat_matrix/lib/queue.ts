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
import { createLogger } from '@open-mercato/shared/lib/logger'

const queueLogger = createLogger('chat_matrix').child({ component: 'queue' })
const LOCAL_WORKER_KEY = '__operisChatMatrixAppserviceWorker__'

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
 * In async mode the auto-discovered worker handles these; in local mode — dev
 * and the QA harness — nothing is listening until something starts a processor
 * in this process. Mirrors how `push_notifications` bootstraps its own.
 */
async function ensureLocalWorkerStarted(): Promise<void> {
  if (process.env.QUEUE_STRATEGY === 'async') return

  const store = globalThis as typeof globalThis & { [LOCAL_WORKER_KEY]?: Promise<void> }
  if (store[LOCAL_WORKER_KEY]) return store[LOCAL_WORKER_KEY]

  store[LOCAL_WORKER_KEY] = (async () => {
    const queue = getAppserviceQueue()
    await queue.process(async (job) => {
      const [{ createRequestContainer }, worker] = await Promise.all([
        import('@open-mercato/shared/lib/di/container'),
        import('../workers/appservice-transaction'),
      ])
      const container = await createRequestContainer()
      await worker.default(job as never, {
        jobId: job.id ?? 'local',
        attemptNumber: 1,
        queueName: CHAT_MATRIX_QUEUES.appserviceTransaction,
        resolve: <T>(name: string) => container.resolve(name) as T,
      } as never)
    })
  })().catch((error) => {
    delete store[LOCAL_WORKER_KEY]
    queueLogger.error('could not start the local appservice worker', {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  })

  return store[LOCAL_WORKER_KEY]
}

export async function enqueueAppserviceTransaction(job: AppserviceTransactionJob): Promise<void> {
  await getAppserviceQueue().enqueue(job)
  await ensureLocalWorkerStarted()
}

export type { EntityManager as ChatMatrixEntityManager }
