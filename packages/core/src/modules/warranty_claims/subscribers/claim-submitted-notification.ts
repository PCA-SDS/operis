import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readTrimmedString } from '@open-mercato/shared/lib/string'

const logger = createLogger('warranty_claims')

export const metadata = {
  event: 'warranty_claims.claim.submitted',
  persistent: true,
  id: 'warranty_claims:claim-submitted-notification',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve<T = unknown>(name: string): T }
  tenantId?: string | null
  organizationId?: string | null
}

export default async function handle(payload: unknown, ctx: ResolverContext): Promise<void> {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const claimId = readTrimmedString(record, 'claimId') ?? readTrimmedString(record, 'id')
  const claimNumber = readTrimmedString(record, 'claimNumber') ?? ''
  const tenantId = ctx.tenantId ?? null
  const organizationId = ctx.organizationId ?? null
  if (!claimId || !tenantId || !organizationId) return

  try {
    const notificationService = resolveNotificationService(ctx.container ?? { resolve: ctx.resolve })
    const typeDef = notificationTypes.find((type) => type.type === 'warranty_claims.claim.submitted')
    if (!typeDef) return
    const notificationInput = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'warranty_claims.claim.manage',
      bodyVariables: { claimNumber },
      sourceEntityType: 'warranty_claims:warranty_claim',
      sourceEntityId: claimId,
      linkHref: `/backend/warranty_claims/${claimId}`,
      groupKey: `warranty_claims.claim.submitted:${claimId}`,
    })
    await notificationService.createForFeature(notificationInput, {
      tenantId,
      organizationId,
    })
  } catch (err) {
    logger.warn('[warranty_claims:claim-submitted-notification] create failed', { err })
  }
}
