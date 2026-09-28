import type { EntityManager } from '@mikro-orm/core'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translatorFallback'
import { ScheduledJob } from '../data/entities.js'

export const DEFAULT_MAX_ACTIVE_SCHEDULES_PER_TENANT = 100
const ACTIVE_SCHEDULE_LIMIT_ENV = 'OM_SCHEDULER_MAX_ACTIVE_SCHEDULES_PER_TENANT'

export function getMaxActiveSchedulesPerTenant(): number {
  const parsed = Number.parseInt(process.env[ACTIVE_SCHEDULE_LIMIT_ENV] ?? '', 10)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return DEFAULT_MAX_ACTIVE_SCHEDULES_PER_TENANT
}

export async function enforceTenantActiveScheduleLimit(
  em: EntityManager,
  tenantId: string | null | undefined,
): Promise<void> {
  if (!tenantId) return

  const maxActiveSchedules = getMaxActiveSchedulesPerTenant()
  const activeScheduleCount = await em.count(ScheduledJob, {
    tenantId,
    isEnabled: true,
    deletedAt: null,
  })

  if (activeScheduleCount >= maxActiveSchedules) {
    const translate = await resolveTranslatorWithFallback()
    throw new CrudHttpError(422, {
      error: translate(
        'scheduler.error.active_schedule_limit',
        'Active scheduled job limit reached for this tenant ({max}).',
        { max: maxActiveSchedules },
      ),
    })
  }
}
