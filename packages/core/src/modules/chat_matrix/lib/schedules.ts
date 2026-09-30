import { stableUuidFromKey } from '@open-mercato/shared/lib/ids'
import { CHAT_MATRIX_QUEUES, DRIFT_CHECK_INTERVAL_SECONDS, SYNC_INTERVAL_SECONDS } from './queue'

export type SchedulerServiceLike = {
  register: (registration: {
    id: string
    name: string
    scopeType: 'system' | 'organization' | 'tenant'
    organizationId?: string
    tenantId?: string
    scheduleType: 'cron' | 'interval'
    scheduleValue: string
    timezone?: string
    targetType: 'queue' | 'command'
    targetQueue?: string
    targetPayload?: unknown
    sourceType?: 'user' | 'module'
    sourceModule?: string
    isEnabled?: boolean
    description?: string
  }) => Promise<void>
}

/**
 * Whether a registration switches the schedule on.
 *
 * `enable` for a schedule being created as part of a tenant's setup. `keep` for
 * the idempotent re-registration every deploy runs: a schedule an operator
 * switched off stays off, and one that does not exist yet is created enabled.
 */
export type ScheduleEnablement = 'enable' | 'keep'

const enabledFlag = (mode: ScheduleEnablement) => (mode === 'enable' ? { isEnabled: true } : {})

/**
 * The `/sync` reader. Registered once, at system scope rather than per
 * organization: there is one appservice and one stream, and a per-organization
 * schedule would start N readers racing for one cursor — each advancing it past
 * events the others had not projected.
 */
export async function registerSyncSchedule(
  scheduler: SchedulerServiceLike,
  mode: ScheduleEnablement,
): Promise<void> {
  await scheduler.register({
    id: stableUuidFromKey('chat_matrix:sync'),
    name: 'Chat Matrix sync',
    description:
      'Reads the appservice /sync stream and projects events Operis does not already know about into chat messages.',
    scopeType: 'system',
    scheduleType: 'interval',
    scheduleValue: `${SYNC_INTERVAL_SECONDS}s`,
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: CHAT_MATRIX_QUEUES.sync,
    targetPayload: {},
    sourceType: 'module',
    sourceModule: 'chat_matrix',
    ...enabledFlag(mode),
  })
}

/** One organization's drift check. The id is persisted — its key must not change. */
export async function registerDriftSchedule(
  scheduler: SchedulerServiceLike,
  scope: { tenantId: string; organizationId: string },
  mode: ScheduleEnablement,
): Promise<void> {
  await scheduler.register({
    id: stableUuidFromKey(`chat_matrix:drift-check:${scope.organizationId}`),
    name: 'Chat Matrix drift check',
    description:
      'Reports messages that were committed to Postgres but never reached the homeserver. Read-only; repair is `yarn mercato chat_matrix backfill`.',
    scopeType: 'organization',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    scheduleType: 'interval',
    scheduleValue: `${DRIFT_CHECK_INTERVAL_SECONDS}s`,
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: CHAT_MATRIX_QUEUES.driftCheck,
    targetPayload: { scope: { tenantId: scope.tenantId, organizationId: scope.organizationId } },
    sourceType: 'module',
    sourceModule: 'chat_matrix',
    ...enabledFlag(mode),
  })
}
