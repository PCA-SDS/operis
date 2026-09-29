import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ChatMatrixSyncState } from './data/entities'
import { CHAT_MATRIX_QUEUES, DEFAULT_SYNC_STREAM } from './lib/queue'
import type { DriftScope } from './lib/drift'
import type { BackfillOptions } from './lib/backfill'
import type { LinkRoomRefusal } from './lib/linkRoom'
import { parseCliArgs } from '@open-mercato/shared/lib/cli/args'

/**
 * Matrix is reached through `await import` in each command, never a top-level
 * import, for the same reason `di.ts` defers it: this file is pulled in EAGERLY
 * by the generated CLI registry, so a static import would put
 * `@open-mercato/matrix` on the startup path of every `yarn mercato` invocation
 * — and of anything else that loads the registry — whether or not the Matrix
 * transport is switched on. Commands are async, so here the ordinary dynamic
 * import is enough; see `di.ts` for why the registrar cannot use one.
 */

const logger = createLogger('chat_matrix').child({ component: 'cli' })

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
  const { checkDrift, formatDriftReport } = await import('./lib/drift')
  const args = parseCliArgs(rest)
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
  const { MatrixClient, matrixConfigFromEnv } = await import('@open-mercato/matrix')
  const { backfillConversations } = await import('./lib/backfill')
  const args = parseCliArgs(rest)
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
  const { default: syncWorker } = await import('./workers/sync')
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

  await syncWorker({ id: 'cli', payload: { drain: true } } as never, {
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

/**
 * The pieces `link-room` and `unlink-room` need. Both need the Matrix transport
 * on: linking a room nothing would ever read is a conversation that silently
 * receives nothing.
 *
 * Every failure in these two commands THROWS. The CLI dispatcher exits 0 for any
 * command that resolves — a `process.exitCode` set on the way is discarded — so
 * a thrown error is the only way a refusal reaches the operator's shell, or a
 * script, as a non-zero exit.
 */
async function outsiderDeps() {
  const { MatrixClient, matrixConfigFromEnv } = await import('@open-mercato/matrix')
  const config = matrixConfigFromEnv()
  if (!config) {
    throw new Error('No homeserver configured. Set OM_MATRIX_HOMESERVER_URL, OM_MATRIX_SERVER_NAME and OM_MATRIX_AS_TOKEN.')
  }
  const container = await createRequestContainer()
  const transport = container.resolve('chatTransport') as { id: string }
  if (transport.id !== 'matrix') {
    throw new Error(`The chat transport is "${transport.id}". Set OM_CHAT_TRANSPORT=matrix before linking a room.`)
  }
  return {
    em: container.resolve<EntityManager>('em').fork(),
    commandBus: container.resolve('commandBus') as import('@open-mercato/shared/lib/commands').CommandBus,
    config,
    container,
    client: new MatrixClient(config),
  }
}

/** A refusal as the CLI prints it: the reason first, so a script can match on it. */
function refused(error: LinkRoomRefusal): Error {
  return new Error(`Refused (${error.refusal}): ${error.message}`)
}

/**
 * Link a bridged room to a new external conversation in one organization.
 *
 *   yarn mercato chat_matrix link-room --room '!abc:server' --tenant <uuid> \
 *     --organization <uuid> --members <userId>[,<userId>…] [--title 'Name']
 *
 * Every check runs before anything is written; see `lib/linkRoom.ts`.
 */
async function linkRoom(rest: string[]): Promise<void> {
  const args = parseCliArgs(rest)
  const room = typeof args.room === 'string' ? args.room : ''
  const tenantId = typeof args.tenant === 'string' ? args.tenant : ''
  const organizationId = typeof args.organization === 'string' ? args.organization : ''
  const members = typeof args.members === 'string' ? args.members.split(',') : []
  if (!room || !tenantId || !organizationId || members.length === 0) {
    throw new Error(
      'Usage: yarn mercato chat_matrix link-room --room <!id:server> --tenant <uuid> --organization <uuid> --members <userId,…> [--title <name>]',
    )
  }
  const deps = await outsiderDeps()
  const { linkExternalRoom, isLinkRoomRefusal } = await import('./lib/linkRoom')
  try {
    const linked = await linkExternalRoom(deps, {
      roomId: room,
      tenantId,
      organizationId,
      memberUserIds: members,
      title: typeof args.title === 'string' ? args.title : null,
    })
    process.stdout.write(`linked  conversation=${linked.conversationId}  outsiders=${linked.contacts}\n`)
  } catch (error) {
    throw isLinkRoomRefusal(error) ? refused(error) : error
  }
}

/**
 * Close a linked external conversation and forget its room.
 *
 *   yarn mercato chat_matrix unlink-room --conversation <uuid>
 */
async function unlinkRoom(rest: string[]): Promise<void> {
  const args = parseCliArgs(rest)
  const conversationId = typeof args.conversation === 'string' ? args.conversation : ''
  if (!conversationId) {
    throw new Error('Usage: yarn mercato chat_matrix unlink-room --conversation <uuid>')
  }
  const deps = await outsiderDeps()
  const { unlinkExternalConversation, isLinkRoomRefusal } = await import('./lib/linkRoom')
  try {
    const unlinked = await unlinkExternalConversation(deps, conversationId)
    process.stdout.write(`unlinked  conversation=${conversationId}  room=${unlinked.roomId} (left as it was)\n`)
  } catch (error) {
    throw isLinkRoomRefusal(error) ? refused(error) : error
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
    command: 'link-room',
    async run(rest) {
      await linkRoom(rest)
    },
  },
  {
    command: 'unlink-room',
    async run(rest) {
      await unlinkRoom(rest)
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
