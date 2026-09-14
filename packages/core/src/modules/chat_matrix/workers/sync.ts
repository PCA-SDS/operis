import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { ChatTransport } from '@open-mercato/core/modules/chat/lib/transport'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  buildSyncFilter,
  parseMatrixEvent,
  type MatrixClient,
  type MatrixConfig,
} from '@open-mercato/matrix'
import { ChatMatrixSyncState } from '../data/entities'
import { projectEvent, projectReceipts, type ProjectionSkipReason } from '../lib/projection'
import { CHAT_MATRIX_QUEUES, DEFAULT_SYNC_STREAM } from '../lib/queue'

const logger = createLogger('chat_matrix').child({ component: 'sync' })

/**
 * How long the homeserver holds the poll open when there is nothing new.
 *
 * Non-zero so an idle deployment costs one parked connection rather than a
 * request every few seconds; short enough that the job still returns and the
 * scheduler stays in control of the cadence.
 */
const LONG_POLL_MS = 20_000

/**
 * How much of each room's tail the FIRST pass takes.
 *
 * An initial `/sync` returns the most recent events in EVERY joined room at
 * once, and the projector touches the database for each of them while the
 * cursor stays where it was — so the first tick after a deployment turns the
 * transport on is the slowest thing this module ever does, and a crash part-way
 * through repeats all of it.
 *
 * This bounds the per-room half of that, which is the half that can be bounded:
 * `/sync` never pages backwards, so events beyond this window were never going
 * to arrive this way regardless — history is `chat_matrix backfill`'s job — and
 * everything after the cursor is delivered normally on later passes.
 *
 * It does NOT bound the other half. Measured against a dev homeserver holding
 * 279 rooms, an initial pass was 2,791 events and took minutes, and lowering
 * this limit barely moved it because most rooms held fewer events than the
 * limit already. The cost there is the ROOM COUNT, which the appservice cannot
 * narrow — it is joined to every conversation by design. A deployment with a
 * large history should expect one slow first tick, and the honest fix if that
 * ever bites is to page the first pass across ticks rather than to shrink this.
 */
const FIRST_PASS_TIMELINE_LIMIT = 10

export type SyncPayload = {
  /**
   * Return as soon as the homeserver answers, instead of parking on the poll.
   *
   * The scheduled tick wants the long poll: one held connection is cheaper than
   * a request every few seconds, and the job returning is what keeps the
   * scheduler in control of the cadence. A person running
   * `yarn mercato chat_matrix sync` wants the opposite — "drain what is there
   * now" — and waiting 20s to be told nothing was makes the command feel broken
   * and makes anything scripted around it 20s slower per call.
   */
  drain?: boolean
}

export const metadata: WorkerMeta = {
  queue: CHAT_MATRIX_QUEUES.sync,
  id: 'chat_matrix:sync',
  // One reader. A second would advance the shared cursor past events the first
  // had not projected yet, and those events would never be seen again.
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Read what the homeserver has, and turn anything Operis does not already know
 * about into a chat message.
 *
 * In `shadow` mode almost every event is our own echo and is skipped by its
 * mapping row; the loop is then a cheap safety net that recovers a message whose
 * publish succeeded and whose commit did not. In `authoritative` mode it is the
 * inbound path proper, and the one a bridge will later feed.
 *
 * The cursor is only advanced after the whole batch has been projected. An
 * exception leaves it where it was, so the next tick re-reads the same events —
 * which is safe precisely because projection is idempotent on `event_id`.
 */
export default async function handle(
  job: QueuedJob<SyncPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  const client = ctx.resolve<MatrixClient>('matrixClient')
  const config = ctx.resolve<MatrixConfig>('matrixConfig')
  const commandBus = ctx.resolve<CommandBus>('commandBus')

  /**
   * Refuse to run unless the Matrix transport is actually bound.
   *
   * This is not defensive noise — it guards a quiet catastrophe. Projection
   * relies on `chat.messages.send` recording the event-to-message mapping, which
   * only the Matrix transport does. If the token resolved to `local` the mapping
   * would never be written, every tick would fail to recognise the event as
   * already handled, and the loop would re-project the same message forever.
   * Failing loudly is enormously better than duplicating a conversation.
   */
  const transport = ctx.resolve<ChatTransport>('chatTransport')
  if (transport.id !== 'matrix') {
    throw new Error(
      `[internal] chat_matrix sync is running but the chat transport is "${transport.id}". Projection would duplicate messages; refusing to read.`,
    )
  }

  // The shape a command expects, from what a worker is given.
  const containerProxy = { resolve: ctx.resolve.bind(ctx) } as never
  const deps = () => ({ em, commandBus, config, client, container: containerProxy })

  const state = await loadState(em)

  try {
    const response = await client.sync({
      since: state.syncToken,
      // A first sync with no cursor must not long-poll: there is a backlog to
      // drain, and waiting 20s for "something new" before returning any of it
      // would stall the first tick for no reason.
      timeoutMs: state.syncToken && !job.payload?.drain ? LONG_POLL_MS : 0,
      /**
       * Receipts, but not typing.
       *
       * A receipt from a colleague reading in Element clears their unread in
       * Operis, which is worth a poll. Typing is not: every Operis user's
       * keystrokes are already announced directly, and one that is not an
       * Operis identity cannot be attributed to anybody yet — so asking for
       * `m.typing` would cost a notification per keystroke in every joined room
       * and buy nothing.
       */
      filter: buildSyncFilter({
        ephemeralTypes: ['m.receipt'],
        ...(state.syncToken ? {} : { timelineLimit: FIRST_PASS_TIMELINE_LIMIT }),
      }),
    })

    const counts: Record<string, number> = { projected: 0 }
    const joined = response.rooms?.join ?? {}

    for (const [roomId, room] of Object.entries(joined)) {
      for (const raw of room?.ephemeral?.events ?? []) {
        // Ephemeral events are the CURRENT state rather than history, so a
        // failure here is not worth stalling the batch over: the next receipt
        // supersedes whatever this one failed to record.
        try {
          counts.receipts = (counts.receipts ?? 0) + (await projectReceipts(deps(), raw, roomId))
        } catch (error) {
          logger.debug('could not apply a read receipt', {
            roomId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      for (const raw of room?.timeline?.events ?? []) {
        const event = parseMatrixEvent(raw)
        if (!event) {
          // One malformed event must not stall the stream. Ordered delivery
          // means everything behind it would be stuck too.
          counts.unparseable = (counts.unparseable ?? 0) + 1
          continue
        }
        const outcome = await projectEvent(deps(), event, roomId)
        if (outcome.kind === 'projected') counts.projected += 1
        else counts[outcome.reason] = (counts[outcome.reason] ?? 0) + 1
      }
    }

    // Only now. Advancing before projecting would drop everything in this batch
    // on a crash, permanently — the homeserver will not hand it over twice.
    state.syncToken = response.next_batch
    state.lastSyncedAt = new Date()
    state.lastError = null
    await em.flush()

    if (counts.projected > 0 || counts.receipts || counts.unparseable) {
      logger.info('sync pass projected events', counts)
    } else {
      logger.debug('sync pass found nothing new', counts)
    }
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error)
    await em.flush()
    // Rethrown so the queue's retry and alerting see it. The cursor was not
    // advanced, so the next attempt re-reads the same events.
    throw error
  }
}

async function loadState(em: EntityManager): Promise<ChatMatrixSyncState> {
  const existing = await em.findOne(ChatMatrixSyncState, { stream: DEFAULT_SYNC_STREAM })
  if (existing) return existing
  const created = em.create(ChatMatrixSyncState, {
    stream: DEFAULT_SYNC_STREAM,
    syncToken: null,
    lastSyncedAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  em.persist(created)
  await em.flush()
  return created
}

export type { ProjectionSkipReason }
