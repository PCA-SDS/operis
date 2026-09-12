import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { MatrixClient, matrixConfigFromEnv } from '@open-mercato/matrix'
import { ChatMatrixSyncState } from './data/entities'
import { CHAT_MATRIX_QUEUES, DEFAULT_SYNC_STREAM } from './lib/queue'
import { checkDrift, formatDriftReport, type DriftScope } from './lib/drift'
import { backfillConversations, type BackfillOptions } from './lib/backfill'
import syncWorker from './workers/sync'

const logger = createLogger('chat_matrix').child({ component: 'cli' })

function parseArgs(rest: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {}
  for (let index = 0; index < rest.length; index += 1) {
    const part = rest[index]
    if (!part?.startsWith('--')) continue
    const [rawKey, rawValue] = part.slice(2).split('=')
    if (!rawKey) continue
    if (rawValue !== undefined) {
      args[rawKey] = rawValue
      continue
    }
    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      args[rawKey] = next
      index += 1
      continue
    }
    args[rawKey] = true
  }
  return args
}

function scopeFrom(args: Record<string, string | boolean>): DriftScope {
  return {
    tenantId: typeof args.tenant === 'string' ? args.tenant : undefined,
    organizationId: typeof args.organization === 'string' ? args.organization : undefined,
  }
}

/**
 * Report whether the homeserver has everything Postgres does.
 *
 * The number that matters is `drifted`: messages written after their room
 * existed that never reached Matrix. It must be zero. `awaitingBackfill` is a
 * separate, expected number — conversations that predate the transport.
 *
 * Exits non-zero when unhealthy, so a cron entry can page on it.
 */
async function drift(rest: string[]): Promise<void> {
  const args = parseArgs(rest)
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const report = await checkDrift(em, scopeFrom(args), {
    sampleLimit: typeof args.samples === 'string' ? Number(args.samples) : 10,
  })

  process.stdout.write(`${formatDriftReport(report)}\n`)

  if (report.samples.length) {
    process.stdout.write('\nOldest messages that never reached the homeserver:\n')
    for (const sample of report.samples) {
      process.stdout.write(
        `  ${sample.createdAt.toISOString()}  conversation=${sample.conversationId}  message=${sample.messageId}\n`,
      )
    }
    process.stdout.write('\nRe-publish them with: yarn mercato chat_matrix backfill\n')
  }

  if (!report.healthy) process.exitCode = 1
}

/**
 * Publish conversations and messages the homeserver does not have.
 *
 * Resumable by construction rather than by bookkeeping: the work queue *is* the
 * set of messages with no `chat_matrix_events` row, so a run that dies halfway
 * has less to do next time and nothing to reconcile. Re-running is idempotent —
 * every publish carries a transaction id derived from the message id, so even a
 * message that was in fact delivered before the mapping was written resolves to
 * the same event rather than a duplicate.
 */
async function backfill(rest: string[]): Promise<void> {
  const args = parseArgs(rest)
  const config = matrixConfigFromEnv()
  if (!config) {
    process.stderr.write(
      'No homeserver configured. Set OM_MATRIX_HOMESERVER_URL, OM_MATRIX_SERVER_NAME and OM_MATRIX_AS_TOKEN.\n',
    )
    process.exitCode = 1
    return
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const options: BackfillOptions = {
    tenantId: typeof args.tenant === 'string' ? args.tenant : undefined,
    organizationId: typeof args.organization === 'string' ? args.organization : undefined,
    limit: typeof args.limit === 'string' ? Number(args.limit) : undefined,
    dryRun: args['dry-run'] === true,
    onProgress: (progress) => {
      process.stdout.write(
        `  ${progress.conversationId}  rooms=${progress.roomsCreated}  published=${progress.messagesPublished}  failed=${progress.messagesFailed}\n`,
      )
    },
  }

  if (options.dryRun) process.stdout.write('DRY RUN — nothing will be sent\n\n')

  const result = await backfillConversations(
    { em, client: new MatrixClient(config), config },
    options,
  )

  process.stdout.write(
    `\nconversations=${result.conversationsProcessed} roomsCreated=${result.roomsCreated} published=${result.messagesPublished} failed=${result.messagesFailed}\n`,
  )
  if (result.messagesFailed > 0) {
    logger.warn('backfill finished with failures; re-run to retry them', {
      failed: result.messagesFailed,
    })
    process.exitCode = 1
  }
}

/**
 * Run one pass of the `/sync` reader, by hand.
 *
 * The same function the scheduled worker runs — this is the operator's way to
 * drain the stream now rather than waiting for the next tick, and the way to
 * see what a pass actually does. Read-only with respect to the homeserver: it
 * reads, projects what Operis does not already have, and advances the cursor.
 */
async function sync(): Promise<void> {
  const container = await createRequestContainer()

  const transport = container.resolve('chatTransport') as { id: string; mode: string }
  if (transport.id !== 'matrix') {
    process.stderr.write(
      `The chat transport is "${transport.id}". Set OM_CHAT_TRANSPORT=matrix and configure a homeserver.\n`,
    )
    process.exitCode = 1
    return
  }

  const em = container.resolve<EntityManager>('em')
  const before = await em.fork().findOne(ChatMatrixSyncState, { stream: DEFAULT_SYNC_STREAM })

  await syncWorker({ id: 'cli', payload: {} } as never, {
    jobId: 'cli',
    attemptNumber: 1,
    queueName: CHAT_MATRIX_QUEUES.sync,
    resolve: <T>(name: string) => container.resolve(name) as T,
  } as never)

  const after = await em.fork().findOne(ChatMatrixSyncState, { stream: DEFAULT_SYNC_STREAM })
  process.stdout.write(
    `transport=${transport.id}/${transport.mode}  cursor=${before?.syncToken ? 'resumed' : 'initial'}` +
      `${before?.syncToken === after?.syncToken ? ' (unchanged — nothing new)' : ' (advanced)'}\n`,
  )
  if (after?.lastError) {
    process.stderr.write(`last error: ${after.lastError}\n`)
    process.exitCode = 1
  }
}

const cli: ModuleCli[] = [
  {
    command: 'drift',
    async run(rest) {
      await drift(rest)
    },
  },
  {
    command: 'backfill',
    async run(rest) {
      await backfill(rest)
    },
  },
  {
    command: 'sync',
    async run() {
      await sync()
    },
  },
]

export default cli
