import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveChatTransportId } from '@open-mercato/core/modules/chat/lib/transport'
import { registerDriftSchedule, registerSyncSchedule, type SchedulerServiceLike } from './lib/schedules'

const logger = createLogger('chat_matrix')

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
   * Register the drift check and the `/sync` reader — but only when this
   * deployment actually runs the Matrix transport.
   *
   * A `local` deployment has no rooms and no events, so the check would query
   * empty tables forever and report perfect health about nothing. A stack that
   * switches to `matrix` after its tenants were set up gets both from
   * `yarn mercato chat_matrix schedules`, which deploy.sh runs on every deploy.
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
      await registerDriftSchedule(schedulerService, { tenantId, organizationId }, 'enable')
      await registerSyncSchedule(schedulerService, 'enable')
    } catch (error) {
      // Best-effort: a scheduler failure must not abort tenant initialization
      // for every other module. The CLI (`yarn mercato chat_matrix drift`)
      // remains available either way.
      logger.warn('failed to register chat_matrix schedules', { err: error })
    }
  },
}

export default setup
