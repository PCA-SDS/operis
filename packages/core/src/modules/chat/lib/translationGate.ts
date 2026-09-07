import { createHash } from 'node:crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('chat').child({ component: 'translationGate' })

/**
 * How much of the engine one process may occupy at once.
 *
 * The engine is a single CPU-bound container shared by every reader in the
 * deployment, so the scarce resource is inference slots, not HTTP connections.
 * Without a ceiling here a handful of readers pressing Translate on a long
 * conversation issue sixty sequential calls each and the queue is the engine's
 * own accept backlog, where it is invisible, unbounded and unattributable.
 */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    logger.warn('Ignoring invalid translation limit; using the default', { name, raw, fallback })
    return fallback
  }
  return parsed
}

export const TRANSLATION_MAX_CONCURRENCY = readPositiveInt('OM_TRANSLATION_MAX_CONCURRENCY', 4)
export const TRANSLATION_MAX_QUEUE = readPositiveInt('OM_TRANSLATION_MAX_QUEUE', 32)

/** Raised when the queue is full rather than making the caller wait unbounded. */
export class TranslationOverloadedError extends Error {
  constructor() {
    super('[internal] translation queue is full')
    this.name = 'TranslationOverloadedError'
  }
}

type Waiter = { resolve: () => void; reject: (error: Error) => void }

let active = 0
const waiting: Waiter[] = []

function release(): void {
  const next = waiting.shift()
  if (next) {
    next.resolve()
    return
  }
  active -= 1
}

/**
 * Run `work` with an inference slot held, or refuse.
 *
 * Refusing is the point. A caller that waits forever behind a saturated engine
 * holds a request, a database connection and the reader's "Translating…" state
 * for as long as the backlog lasts; a caller told it is overloaded can say so
 * and let the reader try again.
 */
export async function withTranslationSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= TRANSLATION_MAX_CONCURRENCY) {
    if (waiting.length >= TRANSLATION_MAX_QUEUE) throw new TranslationOverloadedError()
    await new Promise<void>((resolve, reject) => waiting.push({ resolve, reject }))
  } else {
    active += 1
  }
  try {
    return await work()
  } finally {
    release()
  }
}

/** Observability without message content: how loaded the engine path is. */
export function translationGateDepth(): { active: number; queued: number } {
  return { active, queued: waiting.length }
}

/**
 * Work already in flight, so two readers asking at the same moment cost one
 * inference rather than two.
 *
 * The unique index on `(message_id, target_locale)` makes the second WRITE
 * fail, which is what keeps the cache consistent — but by then both calls have
 * already been paid for. Coalescing here is what stops the engine doing the
 * work twice. Process-local by design: a shared lock across instances would
 * need infrastructure this does not otherwise require, and the database
 * constraint remains the correctness boundary either way.
 */
const inFlight = new Map<string, Promise<unknown>>()

export async function coalesce<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key)
  if (existing) return existing as Promise<T>
  const started = work().finally(() => inFlight.delete(key))
  inFlight.set(key, started)
  return started
}

/**
 * What a cached translation was made from.
 *
 * Two things invalidate a cached row, and neither is expressible as a foreign
 * key. The first is the source text: messages are append-only today, so a body
 * cannot change under a translation — but a cache keyed only on the id would
 * silently serve the old words the moment editing is added, and that is a data
 * defect nobody would see. The second is the pipeline: a different model,
 * tokenizer or preprocessing step produces different output from the same
 * input, so a row made by the previous one is not an answer to the current
 * question.
 *
 * Hashing the normalised body rather than storing it keeps a deleted message's
 * words out of the cache table.
 */
export function sourceHash(normalizedBody: string): string {
  return createHash('sha256').update(normalizedBody, 'utf8').digest('hex')
}

/**
 * The identity of everything that shapes a translation.
 *
 * Bumped by hand when preprocessing changes, and combined with the provider's
 * own model revision so a model swap invalidates without a code change. Rows
 * from a previous revision are not deleted: they are simply not read, and the
 * next request overwrites them in place — a lazy refresh, so an upgrade costs
 * nothing at deploy time and nothing for messages nobody reads again.
 */
const PREPROCESSING_REVISION = '2'

export function pipelineRevision(provider: string, modelRevision: string | null): string {
  return `${provider}/${modelRevision ?? 'unknown'}/p${PREPROCESSING_REVISION}`
}
