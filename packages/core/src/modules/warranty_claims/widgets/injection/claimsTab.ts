import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { CLAIM_STATUS_BADGE_VARIANTS } from '../../backend/components/ClaimStatusBadge'
import type { WarrantyClaimStatus } from '../../data/validators'

export function titleize(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function claimStatusVariant(status: string | null | undefined): StatusBadgeVariant {
  if (!status) return 'neutral'
  return CLAIM_STATUS_BADGE_VARIANTS[status as WarrantyClaimStatus] ?? 'neutral'
}
