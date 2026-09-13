import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { ChatTransport } from '@open-mercato/core/modules/chat/lib/transport'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { parseMatrixEvent, type MatrixClient, type MatrixConfig } from '@open-mercato/matrix'
import { ChatMatrixTransaction } from '../data/entities'
import { projectEvent, projectReceipts } from '../lib/projection'
import { CHAT_MATRIX_QUEUES } from '../lib/queue'

const logger = createLogger('chat_matrix').child({ component: 'appservice' })

export type AppserviceTransactionPayload = {
  txnId: string
  /** Raw events, exactly as the homeserver delivered them. */
  events: unknown[]
  /** Raw ephemeral events — receipts today, typing if it is ever wanted. */
  ephemeral: unknown[]
}

export const metadata: WorkerMeta = {
  queue: CHAT_MATRIX_QUEUES.appserviceTransaction,
  id: 'chat_matrix:appservice-transaction',
  /**
   * One at a time.
   *
   * Synapse delivers appservice transactions **in order** and waits for each to
   * be acknowledged before sending the next. Processing two at once throws that
   * away: a reaction whose message is still in the other job projects as
   * `unmapped-target` and is gone, because a relation is only ever tried once.
   */
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Project a transaction the homeserver pushed at us.
 *
 * The endpoint that received it did no projection at all — it verified the
 * token, recorded the transaction and returned 200. That split is the whole
 * point: Synapse blocks on the HTTP response and holds every later transaction
 * behind it, so anything slow on that path stalls the room for everybody.
 *
 * Everything here is the same projector the `/sync` reader uses, so the two
 * paths cannot drift: whichever delivers an event first wins, and the second
 * finds it already mapped.
 */
export default async function handle(
  job: QueuedJob<AppserviceTransactionPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  const client = ctx.resolve<MatrixClient>('matrixClient')
  const config = ctx.resolve<MatrixConfig>('matrixConfig')
  const commandBus = ctx.resolve<CommandBus>('commandBus')

  /**
   * The same guard the `/sync` worker carries, for the same reason: projection
   * relies on `chat.messages.send` recording the event-to-message mapping,
   * which only the Matrix transport does. Against `local` the mapping would
   * never be written and every redelivery would project the message again.
   */
  const transport = ctx.resolve<ChatTransport>('chatTransport')
  if (transport.id !== 'matrix') {
    throw new Error(
      `[internal] chat_matrix received an appservice transaction but the chat transport is "${transport.id}". Projection would duplicate messages; refusing to process.`,
    )
  }

  const { txnId, events, ephemeral } = job.payload
  const containerProxy = { resolve: ctx.resolve.bind(ctx) } as never
  const deps = { em, commandBus, config, client, container: containerProxy }

  const counts: Record<string, number> = { projected: 0 }

  for (const raw of ephemeral ?? []) {
    // A receipt is current state, not history — the next one supersedes
    // whatever this one failed to record, so it is never worth failing over.
    try {
      const roomId = roomIdOf(raw)
      if (roomId) counts.receipts = (counts.receipts ?? 0) + (await projectReceipts(deps, raw, roomId))
    } catch (error) {
      logger.debug('could not apply a pushed receipt', {
        txnId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  for (const raw of events ?? []) {
    const event = parseMatrixEvent(raw)
    if (!event) {
      counts.unparseable = (counts.unparseable ?? 0) + 1
      continue
    }
    /**
     * `room_id` is on the event here, unlike `/sync` where the room is the key
     * of the map it arrived under. An event without one cannot be placed.
     */
    const roomId = event.room_id
    if (!roomId) {
      counts.unroutable = (counts.unroutable ?? 0) + 1
      continue
    }
    const outcome = await projectEvent(deps, event, roomId)
    if (outcome.kind === 'projected') counts.projected += 1
    else counts[outcome.reason] = (counts[outcome.reason] ?? 0) + 1
  }

  /**
   * Marked done only now.
   *
   * The row exists from the moment the endpoint acknowledged the transaction,
   * so a crash here leaves it recorded and unprocessed — which is exactly what
   * an operator needs to see, and what the `/sync` reader will quietly repair
   * on its next pass.
   */
  const record = await em.fork().findOne(ChatMatrixTransaction, { txnId })
  if (record) {
    record.processedAt = new Date()
    await em.fork().nativeUpdate(ChatMatrixTransaction, { txnId }, { processedAt: record.processedAt })
  }

  logger.info('applied a pushed transaction', { txnId, ...counts })
}

/** An ephemeral event names its own room in the pushed shape. */
function roomIdOf(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const value = (raw as Record<string, unknown>).room_id
  return typeof value === 'string' && value.length > 0 ? value : null
}
