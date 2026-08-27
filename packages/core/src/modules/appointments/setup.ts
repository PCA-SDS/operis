import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { EntityManager } from '@mikro-orm/postgresql'
import { AppointmentStatus } from './data/entities'
import { SYSTEM_APPOINTMENT_STATUS_SEEDS } from './data/constants'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['appointments.*'],
    admin: ['appointments.*'],
    employee: ['appointments.view', 'appointments.create', 'appointments.manage'],
  },
  async seedDefaults({ em, tenantId }: { em: EntityManager; tenantId: string }) {
    await ensureSystemAppointmentStatuses(em, tenantId)
  },
}

export async function ensureSystemAppointmentStatuses(
  em: EntityManager,
  tenantId: string,
): Promise<void> {
  for (const seed of SYSTEM_APPOINTMENT_STATUS_SEEDS) {
    const existing = await em.findOne(AppointmentStatus, {
      tenantId,
      code: seed.code,
      deletedAt: null,
    })
    if (existing) continue
    em.persist(
      em.create(AppointmentStatus, {
        tenantId,
        code: seed.code,
        label: seed.label,
        description: seed.description,
        isSystem: true,
        sortOrder: seed.sortOrder,
      }),
    )
  }
  await em.flush()
}

export default setup
