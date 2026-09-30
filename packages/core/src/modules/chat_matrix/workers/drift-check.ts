import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { MatrixClient, MatrixConfig } from '@open-mercato/matrix'
import { checkAccountHealth } from '../lib/accounts'
import { checkDrift, formatDriftReport } from '../lib/drift'
import { CHAT_MATRIX_QUEUES } from '../lib/queue'

const logger = createLogger('chat_matrix').child({ component: 'drift-check' })

export type DriftCheckPayload = {
  scope: {
    tenantId: string
    organizationId: string | null
  }
}

export const metadata: WorkerMeta = {
  queue: CHAT_MATRIX_QUEUES.driftCheck,
  id: 'chat_matrix:drift-check',
  // One at a time. The check is a handful of aggregate queries and running
  // several concurrently would only contend for the same tables.
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Answer, on a schedule, the question the shadow phase exists to answer: does
 * the homeserver have everything Postgres has?
 *
 * Read-only. It repairs nothing — repair is `yarn mercato chat_matrix backfill`,
 * which is a deliberate act with a homeserver behind it. A monitor that silently
 * fixed what it measured would make the measurement meaningless.
 */
export default async function handle(
  job: QueuedJob<DriftCheckPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  await checkAccounts(job, ctx)
  const report = await checkDrift(em, {
    tenantId: job.payload.scope.tenantId,
    organizationId: job.payload.scope.organizationId ?? undefined,
  })

  const summary = {
    tenantId: job.payload.scope.tenantId,
    organizationId: job.payload.scope.organizationId,
    ...report.rooms,
    messagesInScope: report.messagesInScope,
    messagesDrifted: report.messagesDrifted,
    messagesAwaitingBackfill: report.messagesAwaitingBackfill,
  }

  if (report.healthy) {
    logger.info(formatDriftReport(report), summary)
    return
  }

  // Warn, not error: drift is a condition to act on, not a failed job. Throwing
  // would make the queue retry a read-only check that will report exactly the
  // same thing next time.
  logger.warn(formatDriftReport(report), {
    ...summary,
    oldestDriftedAt: report.oldestDriftedAt?.toISOString() ?? null,
    samples: report.samples.slice(0, 3).map((sample) => sample.messageId),
  })
}

/**
 * The messaging accounts in this organization, asked of their bridge on the
 * same schedule: an account whose phone has been offline too long, or whose
 * link was removed on the phone, is marked disconnected and its managers are
 * told. Never fatal to the drift check — a bridge that cannot be reached is
 * the next run's question.
 */
async function checkAccounts(job: QueuedJob<DriftCheckPayload>, ctx: HandlerContext): Promise<void> {
  const organizationId = job.payload.scope.organizationId
  if (!organizationId) return
  let config: MatrixConfig
  try {
    config = ctx.resolve<MatrixConfig>('matrixConfig')
  } catch {
    return
  }
  if (Object.keys(config.provisioning ?? {}).length === 0) return
  try {
    const changed = await checkAccountHealth(
      {
        em: ctx.resolve<EntityManager>('em'),
        commandBus: ctx.resolve<CommandBus>('commandBus'),
        config,
        client: ctx.resolve<MatrixClient>('matrixClient'),
        container: { resolve: ctx.resolve.bind(ctx) } as never,
      },
      { tenantId: job.payload.scope.tenantId, organizationId },
    )
    if (changed > 0) logger.info('messaging account states changed', { organizationId, changed })
  } catch (error) {
    logger.warn('could not check messaging account health', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
