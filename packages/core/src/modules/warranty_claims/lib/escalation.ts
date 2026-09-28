import type { WarrantyClaimStatus } from '../data/validators'
import { trimToUndefined } from '@open-mercato/shared/lib/string'
import { toRecordOrNull } from '@open-mercato/shared/lib/guards'

export type EscalationTier = {
  atPct: number
  action: 'notify' | 'reassign'
  toUserId?: string
}

export type SlaEscalationCandidateInput = {
  status: WarrantyClaimStatus
  slaPausedAt?: Date | string | null
  slaDueAt?: Date | string | null
  submittedAt?: Date | string | null
}

const SLA_TERMINAL_STATUSES = new Set<WarrantyClaimStatus>([
  'resolved',
  'closed',
  'cancelled',
  'rejected',
])

function parseAction(value: unknown): EscalationTier['action'] | null {
  return value === 'notify' || value === 'reassign' ? value : null
}

function parseAtPct(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function parseEscalationTiers(raw: unknown): EscalationTier[] {
  if (!Array.isArray(raw)) return []
  const tiers: EscalationTier[] = []

  for (const item of raw) {
    const record = toRecordOrNull(item)
    if (!record) continue
    const atPct = parseAtPct(record.atPct)
    const action = parseAction(record.action)
    if (atPct === null || action === null) continue

    const toUserId = trimToUndefined(record.toUserId)
    if (action === 'reassign' && !toUserId) continue
    tiers.push(toUserId ? { atPct, action, toUserId } : { atPct, action })
  }

  return tiers.sort((left, right) => left.atPct - right.atPct)
}

export function tiersToFire(
  progressPct: number,
  currentLevel: number,
  tiers: EscalationTier[],
): { tierIndex: number; tier: EscalationTier }[] {
  if (!Number.isFinite(progressPct)) return []
  const normalizedLevel = Number.isFinite(currentLevel) ? Math.max(0, Math.floor(currentLevel)) : 0
  return tiers
    .map((tier, index) => ({ tierIndex: index + 1, tier }))
    .filter((entry) => entry.tier.atPct <= progressPct && entry.tierIndex > normalizedLevel)
}

export function isSlaEscalationTerminalStatus(status: WarrantyClaimStatus): boolean {
  return SLA_TERMINAL_STATUSES.has(status)
}

export function isSlaEscalationCandidate(claim: SlaEscalationCandidateInput): boolean {
  if (isSlaEscalationTerminalStatus(claim.status)) return false
  if (claim.slaPausedAt !== null && claim.slaPausedAt !== undefined) return false
  if (claim.slaDueAt === null || claim.slaDueAt === undefined) return false
  if (claim.submittedAt === null || claim.submittedAt === undefined) return false
  return true
}
