import { reconcileVendorRecoverySourceClaim } from '../commands/shared'
import { readTrimmedString } from '@open-mercato/shared/lib/string'

export const metadata = {
  event: 'warranty_claims.claim.status_changed',
  persistent: true,
  id: 'warranty_claims:vendor-recovery-reconciliation',
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
  tenantId?: string | null
  organizationId?: string | null
}

export default async function handle(payload: unknown, ctx: HandlerContext): Promise<void> {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const claimId = readTrimmedString(record, 'claimId') ?? readTrimmedString(record, 'id')
  const tenantId = ctx.tenantId ?? null
  const organizationId = ctx.organizationId ?? null
  const claimType = readTrimmedString(record, 'claimType')
  const toStatus = readTrimmedString(record, 'toStatus') ?? readTrimmedString(record, 'status')
  if (!claimId || !tenantId || !organizationId) return
  if (claimType !== 'vendor_recovery' || (toStatus !== 'resolved' && toStatus !== 'closed')) return

  await reconcileVendorRecoverySourceClaim(ctx, { claimId, tenantId, organizationId })
}
