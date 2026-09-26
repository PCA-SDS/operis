import type { EntityManager } from '@mikro-orm/postgresql'
import { PlannerAvailabilityRule, PlannerAvailabilityRuleSet, PlannerOrganizationAvailabilitySettings } from '../data/entities'
import { getMergedAvailabilityWindows, type AvailabilityWindow } from './availabilityMerge'

const DAY_MS = 24 * 60 * 60 * 1000

export type OrganizationAvailabilityPolicy = {
  organizationId: string
  operatingHoursRuleSetId: string
  timezone: string
  lastCustomerBeforeCloseMinutes: number
  timeOverflowMinutes: number
  rules: Array<{
    id: string
    rrule: string
    exdates: string[]
    kind: 'availability' | 'unavailability'
    lastCustomerBeforeCloseMinutes?: number | null
    lastCustomerAcceptanceMinutes?: number | null
    timeOverflowMinutes?: number | null
    updatedAt?: Date | string | null
  }>
}

export type OrganizationAvailabilityWindow = AvailabilityWindow & {
  latestNewBookingStart: Date
  operatingEnd: Date
  lastCustomerAcceptanceMinutes: number | null
  timeOverflowMinutes: number
}

export async function loadOrganizationAvailabilityPolicy(
  em: EntityManager,
  params: { tenantId: string; organizationIds: string[] },
): Promise<OrganizationAvailabilityPolicy | null> {
  if (params.organizationIds.length === 0) return null
  const settings = await em.find(PlannerOrganizationAvailabilitySettings, {
    tenantId: params.tenantId,
    organizationId: { $in: params.organizationIds },
    deletedAt: null,
  })
  const settingsByOrganization = new Map(settings.map((record) => [record.organizationId, record]))
  const selected = params.organizationIds
    .map((organizationId) => settingsByOrganization.get(organizationId))
    .find((record): record is PlannerOrganizationAvailabilitySettings => Boolean(record))
  if (!selected) return null

  const ruleSet = await em.findOne(PlannerAvailabilityRuleSet, {
    id: selected.operatingHoursRuleSetId,
    tenantId: params.tenantId,
    organizationId: selected.organizationId,
    deletedAt: null,
  })
  if (!ruleSet) return null

  const rules = await em.find(PlannerAvailabilityRule, {
    tenantId: params.tenantId,
    organizationId: selected.organizationId,
    subjectType: 'ruleset',
    subjectId: ruleSet.id,
    deletedAt: null,
  })

  return {
    organizationId: selected.organizationId,
    operatingHoursRuleSetId: ruleSet.id,
    timezone: ruleSet.timezone,
    lastCustomerBeforeCloseMinutes: selected.lastCustomerBeforeCloseMinutes ?? 0,
    timeOverflowMinutes: selected.timeOverflowMinutes ?? 0,
    rules: rules.map((rule) => ({
      id: rule.id,
      rrule: rule.rrule,
      exdates: rule.exdates ?? [],
      kind: rule.kind,
      lastCustomerBeforeCloseMinutes: rule.lastCustomerBeforeCloseMinutes ?? null,
      lastCustomerAcceptanceMinutes: rule.lastCustomerAcceptanceMinutes ?? null,
      timeOverflowMinutes: rule.timeOverflowMinutes ?? null,
      updatedAt: rule.updatedAt ?? null,
    })),
  }
}

function resolveLocalDateParts(value: Date, timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
  }
}

function resolveTimeInTimezone(value: Date, totalMinutes: number, timezone: string): Date {
  const localDate = resolveLocalDateParts(value, timezone)
  const localAsUtc = Date.UTC(
    localDate.year,
    localDate.month - 1,
    localDate.day,
    Math.floor(totalMinutes / 60),
    totalMinutes % 60,
    0,
    0,
  )
  let result = localAsUtc
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rendered = resolveLocalDateParts(new Date(result), timezone)
    const renderedParts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(result))
    const values = new Map(renderedParts.map((part) => [part.type, part.value]))
    const renderedAsUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      Number(values.get('hour')),
      Number(values.get('minute')),
      0,
      0,
    )
    result -= renderedAsUtc - localAsUtc
  }
  return new Date(result)
}

function resolveLatestNewBookingStart(
  operatingEnd: Date,
  rule: OrganizationAvailabilityPolicy['rules'][number] | undefined,
  legacyFallbackMinutes: number,
  timezone: string,
): Date {
  if (typeof rule?.lastCustomerAcceptanceMinutes === 'number') {
    return resolveTimeInTimezone(operatingEnd, rule.lastCustomerAcceptanceMinutes, timezone)
  }
  const minutesBeforeClose = rule?.lastCustomerBeforeCloseMinutes ?? legacyFallbackMinutes
  return new Date(operatingEnd.getTime() - minutesBeforeClose * 60_000)
}

export function resolveOrganizationAvailabilityWindows(
  policy: OrganizationAvailabilityPolicy,
  range: { start: Date; end: Date },
): OrganizationAvailabilityWindow[] {
  const operatingWindows = getMergedAvailabilityWindows({
    rules: policy.rules,
    range,
  })
  const rulesById = new Map(policy.rules.map((rule) => [rule.id, rule]))
  const uniqueOperatingWindows = new Map<string, typeof operatingWindows[number]>()
  operatingWindows.forEach((window) => {
    const key = `${window.start.getTime()}:${window.end.getTime()}`
    const existing = uniqueOperatingWindows.get(key)
    if (!existing) {
      uniqueOperatingWindows.set(key, window)
      return
    }
    const existingRule = existing.ruleId ? rulesById.get(existing.ruleId) : undefined
    const candidateRule = window.ruleId ? rulesById.get(window.ruleId) : undefined
    const existingUpdatedAt = existingRule?.updatedAt ? new Date(existingRule.updatedAt).getTime() : 0
    const candidateUpdatedAt = candidateRule?.updatedAt ? new Date(candidateRule.updatedAt).getTime() : 0
    if (candidateUpdatedAt > existingUpdatedAt) uniqueOperatingWindows.set(key, window)
  })
  return Array.from(uniqueOperatingWindows.values()).map((window) => {
    const matchingRule = rulesById.get(window.ruleId ?? '')
    const timeOverflowMinutes = matchingRule?.timeOverflowMinutes ?? policy.timeOverflowMinutes
    return {
      start: window.start,
      end: new Date(window.end.getTime() + timeOverflowMinutes * 60_000),
      ruleId: window.ruleId,
      operatingEnd: window.end,
      lastCustomerAcceptanceMinutes: matchingRule?.lastCustomerAcceptanceMinutes ?? null,
      timeOverflowMinutes,
      latestNewBookingStart: resolveLatestNewBookingStart(
        window.end,
        matchingRule,
        policy.lastCustomerBeforeCloseMinutes,
        policy.timezone,
      ),
    }
  })
}

export function intersectAvailabilityWindows(
  left: AvailabilityWindow[],
  right: AvailabilityWindow[],
): AvailabilityWindow[] {
  const result: AvailabilityWindow[] = []
  for (const leftWindow of left) {
    for (const rightWindow of right) {
      const start = leftWindow.start > rightWindow.start ? leftWindow.start : rightWindow.start
      const end = leftWindow.end < rightWindow.end ? leftWindow.end : rightWindow.end
      if (start < end) result.push({ start, end })
    }
  }
  return result.sort((a, b) => a.start.getTime() - b.start.getTime())
}

export type OrganizationBookingValidation = {
  valid: boolean
  code?: 'BOOKING_START_AFTER_LAST_CUSTOMER' | 'BOOKING_END_AFTER_OVERFLOW'
  window?: OrganizationAvailabilityWindow
}

export type OrganizationRuntimeValidation = {
  valid: boolean
  code?: 'BOOKING_START_OUTSIDE_OPERATING_HOURS' | 'BOOKING_END_AFTER_OVERFLOW'
  window?: OrganizationAvailabilityWindow
}

export function validateBookingRuntimeAgainstOrganizationAvailability(
  policy: OrganizationAvailabilityPolicy,
  params: { startsAt: Date; endsAt: Date },
): OrganizationRuntimeValidation {
  const range = {
    start: new Date(params.startsAt.getTime() - DAY_MS),
    end: new Date(params.endsAt.getTime() + DAY_MS),
  }
  const windows = resolveOrganizationAvailabilityWindows(policy, range)
  const matchingWindow = windows.find((window) =>
    window.start <= params.startsAt && window.operatingEnd >= params.startsAt,
  )
  if (!matchingWindow) {
    return { valid: false, code: 'BOOKING_START_OUTSIDE_OPERATING_HOURS' }
  }
  if (matchingWindow.end < params.endsAt) {
    return {
      valid: false,
      code: 'BOOKING_END_AFTER_OVERFLOW',
      window: matchingWindow,
    }
  }
  return { valid: true, window: matchingWindow }
}

export function validateBookingAgainstOrganizationAvailability(
  policy: OrganizationAvailabilityPolicy,
  params: { startsAt: Date; endsAt: Date },
): OrganizationBookingValidation {
  const range = {
    start: new Date(params.startsAt.getTime() - DAY_MS),
    end: new Date(params.endsAt.getTime() + DAY_MS),
  }
  const windows = resolveOrganizationAvailabilityWindows(policy, range)
  const matchingWindow = windows.find((window) =>
    window.start <= params.startsAt && window.end >= params.endsAt,
  )
  if (!matchingWindow) {
    return { valid: false, code: 'BOOKING_END_AFTER_OVERFLOW' }
  }
  if (params.startsAt > matchingWindow.latestNewBookingStart) {
    return {
      valid: false,
      code: 'BOOKING_START_AFTER_LAST_CUSTOMER',
      window: matchingWindow,
    }
  }
  return { valid: true, window: matchingWindow }
}

export function validateResourceWindowsWithinOrganization(
  policy: OrganizationAvailabilityPolicy,
  resourceWindows: AvailabilityWindow[],
  range: { start: Date; end: Date },
): boolean {
  const organizationWindows = resolveOrganizationAvailabilityWindows(policy, range)
  return resourceWindows.every((resourceWindow) =>
    organizationWindows.some((organizationWindow) =>
      organizationWindow.start <= resourceWindow.start && organizationWindow.operatingEnd >= resourceWindow.end,
    ),
  )
}

export async function validateResourceAvailabilityRuleSetWithinOrganization(
  em: EntityManager,
  params: { tenantId: string; organizationId: string; organizationIds?: string[]; resourceRuleSetId: string },
): Promise<{ valid: boolean; code?: 'INVALID_RESOURCE_AVAILABILITY_RULE_SET' | 'RESOURCE_AVAILABILITY_EXCEEDS_STORE_HOURS' }> {
  const ruleSet = await em.findOne(PlannerAvailabilityRuleSet, {
    id: params.resourceRuleSetId,
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    deletedAt: null,
  })
  if (!ruleSet) return { valid: false, code: 'INVALID_RESOURCE_AVAILABILITY_RULE_SET' }

  const policy = await loadOrganizationAvailabilityPolicy(em, {
    tenantId: params.tenantId,
    organizationIds: params.organizationIds ?? [params.organizationId],
  })
  if (!policy) return { valid: true }

  const rules = await em.find(PlannerAvailabilityRule, {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    subjectType: 'ruleset',
    subjectId: params.resourceRuleSetId,
    deletedAt: null,
  })
  if (rules.length === 0) return { valid: true }

  const now = new Date()
  const range = {
    start: new Date(now.getTime() - 366 * DAY_MS),
    end: new Date(now.getTime() + 3 * 366 * DAY_MS),
  }
  const resourceWindows = getMergedAvailabilityWindows({
    rules: rules.map((rule) => ({
      id: rule.id,
      rrule: rule.rrule,
      exdates: rule.exdates,
      kind: rule.kind,
    })),
    range,
  })
  return validateResourceWindowsWithinOrganization(policy, resourceWindows, range)
    ? { valid: true }
    : { valid: false, code: 'RESOURCE_AVAILABILITY_EXCEEDS_STORE_HOURS' }
}
