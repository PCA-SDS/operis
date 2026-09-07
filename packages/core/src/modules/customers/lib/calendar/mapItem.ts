import { addMinutes } from 'date-fns/addMinutes'
import type {
  CalendarInteractionItem,
  CalendarInteractionPayload,
  CalendarItem,
  CalendarItemStatus,
  CalendarLocationKind,
  CalendarParticipant,
  CalendarPlatform,
} from '../../components/calendar/types'
import { categoryOf } from './categories'
import { MINUTES_PER_DAY, addCalendarDays, startOfLocalDay } from './time'

const DEFAULT_DURATION_MINUTES = 30

/**
 * How many whole days an all-day entry covers. `durationMinutes` is the only
 * field carrying span for an all-day interaction, so a null or sub-day value
 * means a single day.
 */
export function allDaySpanDays(durationMinutes: number | null | undefined): number {
  if (typeof durationMinutes !== 'number' || !Number.isFinite(durationMinutes) || durationMinutes <= 0) return 1
  return Math.max(1, Math.ceil(durationMinutes / MINUTES_PER_DAY))
}

function narrowStatus(status: string): CalendarItemStatus {
  if (status === 'done') return 'done'
  if (status === 'canceled') return 'canceled'
  return 'planned'
}

export function detectPlatform(location: string | null): CalendarPlatform | null {
  if (!location) return null
  const normalized = location.toLowerCase()
  if (normalized.includes('zoom.us') || normalized.includes('zoom')) return 'zoom'
  if (normalized.includes('meet.google') || normalized.includes('on meet')) return 'meet'
  if (normalized.includes('slack')) return 'slack'
  if (normalized.includes('teams')) return 'teams'
  return null
}

/**
 * The joinable URL behind an entry's location, when there is one. Shared by the
 * grid, the peek popover and the screen so "Join" means the same thing
 * everywhere.
 */
export function resolveJoinUrl(location: string | null): string | null {
  const trimmed = location?.trim() ?? ''
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`
  return null
}

function detectLocationKind(location: string | null, platform: CalendarPlatform | null): CalendarLocationKind | null {
  if (!location) return null
  const normalized = location.trim().toLowerCase()
  if (normalized.startsWith('http') || normalized.startsWith('www')) return 'url'
  if (platform) return 'platform'
  return 'venue'
}

function mapParticipants(payload: CalendarInteractionPayload): CalendarParticipant[] {
  const participants = payload.participants
  if (!Array.isArray(participants)) return []
  const seen = new Set<string>()
  const mapped: CalendarParticipant[] = []
  for (const participant of participants) {
    if (seen.has(participant.userId)) continue
    seen.add(participant.userId)
    const entry: CalendarParticipant = { userId: participant.userId }
    if (typeof participant.name === 'string') entry.name = participant.name
    if (typeof participant.email === 'string') entry.email = participant.email
    mapped.push(entry)
  }
  return mapped
}

export function mapInteractionToCalendarItem(
  payload: CalendarInteractionPayload,
  typeColorByType: Record<string, string | null>,
): CalendarInteractionItem | null {
  const effectiveStartRaw = payload.occurredAt ?? payload.scheduledAt ?? null
  if (!effectiveStartRaw) return null
  const parsedStart = new Date(effectiveStartRaw)
  if (Number.isNaN(parsedStart.getTime())) return null

  const allDay = payload.allDay === true
  let start: Date
  let end: Date
  if (allDay) {
    // All-day entries occupy whole calendar days: start at local midnight and
    // end at the midnight closing the last day they cover, so a multi-day
    // booking renders as one continuous bar instead of a single-day chip.
    start = startOfLocalDay(parsedStart)
    end = addCalendarDays(start, allDaySpanDays(payload.durationMinutes))
  } else {
    start = parsedStart
    end = addMinutes(parsedStart, payload.durationMinutes ?? DEFAULT_DURATION_MINUTES)
  }

  const location = payload.location ?? null
  const platform = detectPlatform(location)

  return {
    source: 'interaction',
    id: payload.id,
    title: payload.title ?? '',
    interactionType: payload.interactionType,
    category: categoryOf(payload.interactionType),
    status: narrowStatus(payload.status),
    start,
    end,
    allDay,
    location,
    platform,
    locationKind: detectLocationKind(location, platform),
    participants: mapParticipants(payload),
    ownerUserId: payload.ownerUserId ?? null,
    entityId: payload.entityId ?? null,
    dealId: payload.dealId ?? null,
    color: payload.appearanceColor ?? typeColorByType[payload.interactionType] ?? null,
    isRecurringOccurrence: false,
    updatedAt: payload.updatedAt ?? null,
    raw: payload,
  }
}
