import type { FilterOptionTone } from '@open-mercato/shared/lib/query/advanced-filter'

export const STAGE_BADGE_TONE_CLASS: Record<FilterOptionTone, string> = {
  success: 'bg-status-success-bg text-status-success-text',
  error: 'bg-status-error-bg text-status-error-text',
  warning: 'bg-status-warning-bg text-status-warning-text',
  info: 'bg-status-info-bg text-status-info-text',
  neutral: 'bg-status-neutral-bg text-status-neutral-text',
  brand: 'bg-brand-violet/14 text-brand-violet',
  pink: 'bg-status-pink-bg text-status-pink-text',
}

export function getStageBadgeClass(tone: FilterOptionTone | null): string {
  if (tone && tone in STAGE_BADGE_TONE_CLASS) return STAGE_BADGE_TONE_CLASS[tone]
  return 'bg-muted text-muted-foreground'
}
