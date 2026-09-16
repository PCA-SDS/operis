import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'appointments.appointment.created',
  persistent: true,
  id: 'appointments:appointment-created-notification',
}

type AppointmentCreatedPayload = {
  id: string
  tenantId: string
  organizationId: string
  customerName?: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

async function resolveOrganizationName(
  payload: AppointmentCreatedPayload,
  ctx: ResolverContext,
): Promise<string> {
  try {
    const em = ctx.resolve<EntityManager>('em')?.fork()
    if (!em) return payload.organizationId

    const organization = await findOneWithDecryption(
      em,
      Organization,
      { id: payload.organizationId, tenant: payload.tenantId, deletedAt: null },
      undefined,
      { tenantId: payload.tenantId, organizationId: payload.organizationId },
    )
    return organization?.name?.trim() || payload.organizationId
  } catch {
    return payload.organizationId
  }
}

export default async function handle(
  payload: AppointmentCreatedPayload,
  ctx: ResolverContext,
): Promise<void> {
  const typeDef = notificationTypes.find((type) => type.type === 'appointments.appointment.created')
  if (!typeDef) return

  const notificationService = resolveNotificationService(ctx)
  const organizationName = await resolveOrganizationName(payload, ctx)
  const notificationInput = {
    ...buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'appointments.view',
      sourceEntityType: 'appointment',
      sourceEntityId: payload.id,
      linkHref: `/backend/appointments/${encodeURIComponent(payload.id)}`,
      groupKey: `appointment.created:${payload.id}`,
      bodyVariables: {
        customerName: payload.customerName ?? 'customer',
        organizationName,
      },
    }),
    restrictRecipientsToOrganization: true,
  }

  await notificationService.createForFeature(notificationInput, {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  })
}
