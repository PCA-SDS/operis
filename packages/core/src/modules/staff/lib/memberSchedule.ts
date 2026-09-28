import type { ScheduleItem } from '@open-mercato/ui/backend/schedule'
import { parseAvailabilityRuleWindow, toFullDayWindow } from '@open-mercato/core/modules/planner/lib/availabilitySchedule'

const DEFAULT_TITLE_MAP = {
  weekly: 'Weekly availability',
  daily: 'Daily availability',
  once: 'Availability',
}

export function buildMemberScheduleItems(params: {
  availabilityRules: Array<{
    id: string
    rrule: string
    createdAt?: string | null
    kind?: 'availability' | 'unavailability'
    note?: string | null
    exdates?: string[]
  }>
  translate: (key: string, fallback?: string) => string
}): ScheduleItem[] {
  const overrideExdates = Array.from(new Set(
    params.availabilityRules
      .map((rule) => parseAvailabilityRuleWindow(rule))
      .filter((window) => window.repeat === 'once')
      .map((window) => toFullDayWindow(window.startAt).start.toISOString()),
  ))
  const availabilityItems = params.availabilityRules.map((rule) => {
    const window = parseAvailabilityRuleWindow(rule)
    const isUnavailable = rule.kind === 'unavailability'
    const titleKey = isUnavailable
      ? 'staff.teamMembers.availability.unavailable.title'
      : `staff.teamMembers.availability.title.${window.repeat}`
    const fallback = isUnavailable ? 'Unavailable' : DEFAULT_TITLE_MAP[window.repeat]
    const baseTitle = params.translate(titleKey, fallback)
    const title = rule.note ? `${baseTitle}: ${rule.note}` : baseTitle
    const windowTime = window.repeat === 'once' ? toFullDayWindow(window.startAt) : { start: window.startAt, end: window.endAt }
    const exdates = window.repeat === 'once'
      ? rule.exdates ?? []
      : [...(rule.exdates ?? []), ...overrideExdates]
    return {
      id: rule.id,
      kind: isUnavailable ? 'exception' as const : 'availability' as const,
      title,
      startsAt: windowTime.start,
      endsAt: windowTime.end,
      metadata: { rule: { ...rule, exdates } },
    }
  })
  return availabilityItems
}
