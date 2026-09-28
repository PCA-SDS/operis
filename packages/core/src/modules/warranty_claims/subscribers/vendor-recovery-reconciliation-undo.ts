import { reconcileVendorRecoverySourceClaim } from '../commands/shared'
import { readTrimmedString } from '@open-mercato/shared/lib/string'

export const metadata = {
  event: 'warranty_claims.claim.updated',
  persistent: true,
  id: 'warranty_claims:vendor-recovery-reconciliation-undo',
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
  tenantId?: string | null
  organizationId?: string | null
}

export default async function handle(payload: unknown, ctx: HandlerContext): Promise<void> {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  if (readTrimmedString(record, 'claimType') !== 'vendor_recovery') return
  const claimId = readTrimmedString(record, 'claimId') ?? readTrimmedString(record, 'id')
  const tenantId = ctx.tenantId ?? null
  const organizationId = ctx.organizationId ?? null
  if (!claimId || !tenantId || !organizationId) return
  await reconcileVendorRecoverySourceClaim(ctx, { claimId, tenantId, organizationId })
}
