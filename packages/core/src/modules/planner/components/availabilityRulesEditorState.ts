export type AvailabilityRuleSetOption = {
  id: string
}

export type AvailabilityRuleRef = {
  id: string
}

export type RuleSetTransition = 'switch' | 'reset'

export function resolveRuleSetSelectValue(
  ruleSets: AvailabilityRuleSetOption[],
  selectedRulesetId: string | null | undefined,
): string | undefined {
  if (!selectedRulesetId) return undefined
  return ruleSets.some((ruleSet) => ruleSet.id === selectedRulesetId) ? selectedRulesetId : undefined
}

function readOptionalNumber(record: Record<string, unknown>, camelKey: string, snakeKey: string): number | null | undefined {
  const camelValue = record[camelKey]
  if (typeof camelValue === 'number' || camelValue === null) return camelValue
  const snakeValue = record[snakeKey]
  if (typeof snakeValue === 'number' || snakeValue === null) return snakeValue
  return undefined
}

export function normalizeAvailabilityRuleRecord<T extends object>(item: T): T & {
  lastCustomerAcceptanceMinutes?: number | null
  timeOverflowMinutes?: number | null
  updatedAt?: string | null
} {
  const record = item as Record<string, unknown>
  const lastCustomerAcceptanceMinutes = readOptionalNumber(
    record,
    'lastCustomerAcceptanceMinutes',
    'last_customer_acceptance_minutes',
  )
  const timeOverflowMinutes = readOptionalNumber(record, 'timeOverflowMinutes', 'time_overflow_minutes')
  const updatedAt = typeof record.updatedAt === 'string' || record.updatedAt === null
    ? record.updatedAt
    : typeof record.updated_at === 'string'
      ? record.updated_at
      : undefined

  return {
    ...item,
    ...(lastCustomerAcceptanceMinutes !== undefined ? { lastCustomerAcceptanceMinutes } : {}),
    ...(timeOverflowMinutes !== undefined ? { timeOverflowMinutes } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  }
}

// Selects which member-level custom rules to delete for a ruleset transition.
// Switching schedules preserves the member's saved custom hours (#2325): only
// an explicit "Reset to schedule" discards them so the shared schedule applies.
export function selectCustomRuleIdsToDelete(
  transition: RuleSetTransition,
  rules: AvailabilityRuleRef[],
): string[] {
  if (transition === 'switch') return []
  return Array.from(new Set(rules.map((rule) => rule.id)))
}

export function requiresResetConfirmation(rules: AvailabilityRuleRef[]): boolean {
  return rules.length > 0
}
