import { createHash } from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveChatTransportId } from '@open-mercato/core/modules/chat/lib/transport'
import {
  CHAT_MATRIX_QUEUES,
  DRIFT_CHECK_INTERVAL_SECONDS,
  SYNC_INTERVAL_SECONDS,
} from './lib/queue'

const logger = createLogger('chat_matrix')

type SchedulerServiceLike = {
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
 * Deterministic so `register()` is an idempotent upsert across re-runs, and a
 * uuid because that is what the schedule primary key is.
 */
function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Nothing to seed. The module owns four mapping tables written by the transport
 * and by nothing else, so a fresh tenant starts with them empty and that is the
 * correct state.
 *
 * Only administrators get the health view: a misconfigured transport is an
 * operations problem, and what it exposes is room ids and drift counts rather
 * than anything an employee would act on.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['chat_matrix.*'],
  },

  /**
   * Register the drift check — but only when this deployment actually runs the
   * Matrix transport.
   *
   * A `local` deployment has no rooms and no events, so the check would query
   * empty tables forever and report perfect health about nothing. Gating on the
   * transport keeps a scheduled job from existing until there is something for
   * it to watch.
   */
  async seedDefaults({ tenantId, organizationId, container }) {
    if (resolveChatTransportId() !== 'matrix') return

    const cradle = container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) {
      // Keeps the module usable in scheduler-less test harnesses, matching how
      // the communication-channels hub degrades.
      return
    }

    const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
    try {
      await schedulerService.register({
        id: stableScheduleUuid(`chat_matrix:drift-check:${organizationId}`),
        name: 'Chat Matrix drift check',
        description:
          'Reports messages that were committed to Postgres but never reached the homeserver. Read-only; repair is `yarn mercato chat_matrix backfill`.',
        scopeType: 'organization',
        organizationId,
        tenantId,
        scheduleType: 'interval',
        scheduleValue: `${DRIFT_CHECK_INTERVAL_SECONDS}s`,
        timezone: 'UTC',
        targetType: 'queue',
        targetQueue: CHAT_MATRIX_QUEUES.driftCheck,
        targetPayload: { scope: { tenantId, organizationId } },
        sourceType: 'module',
        sourceModule: 'chat_matrix',
        isEnabled: true,
      })
      /**
       * The `/sync` reader.
       *
       * Registered once, at system scope rather than per organization: there is
       * one appservice and one stream, and a per-organization schedule would
       * start N readers racing for one cursor — each advancing it past events
       * the others had not projected.
       */
      await schedulerService.register({
        id: stableScheduleUuid('chat_matrix:sync'),
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
        isEnabled: true,
      })
    } catch (error) {
      // Best-effort: a scheduler failure must not abort tenant initialization
      // for every other module. The CLI (`yarn mercato chat_matrix drift`)
      // remains available either way.
      logger.warn('failed to register chat_matrix schedules', { err: error })
    }
  },
}

export default setup
