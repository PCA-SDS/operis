import type { EntityManager } from '@mikro-orm/postgresql'
import { Appointment } from '../../data/entities'

export async function loadScopedAppointment(
  em: EntityManager,
  tenantId: string,
  id: string,
  orgWhere: Record<string, unknown>,
): Promise<Appointment | null> {
  return em.findOne(Appointment, {
    id,
    tenantId,
    ...orgWhere,
    deletedAt: null,
  })
}
