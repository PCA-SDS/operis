export type SyncScheduleEditorState = {
  id?: string
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone: string
  fullSync: boolean
  isEnabled: boolean
  lastRunAt: string | null
  updatedAt?: string | null
}

export const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function buildDefaultScheduleState(entityType: string): SyncScheduleEditorState {
  const normalized = entityType.trim().toLowerCase()
  const longerInterval = normalized === 'categories' || normalized === 'attributes'
  return {
    scheduleType: 'interval',
    scheduleValue: longerInterval ? '6h' : '1h',
    timezone: DEFAULT_TIMEZONE,
    fullSync: normalized !== 'products',
    isEnabled: true,
    lastRunAt: null,
    updatedAt: null,
  }
}

export function formatEntityTypeLabel(entityType: string): string {
  return entityType
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
