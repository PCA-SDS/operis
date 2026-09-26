import type { BadgeProps } from '@open-mercato/ui/primitives/badge'

export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent'

/**
 * Get the Badge variant for a given priority level
 */
export function getPriorityBadgeVariant(priority: MessagePriority): BadgeProps['variant'] {
  switch (priority) {
    case 'low':
      return 'muted'
    case 'normal':
      return 'secondary'
    case 'high':
      return 'default'
    case 'urgent':
      return 'destructive'
    default:
      return 'secondary'
  }
}

/**
 * Get custom CSS classes for priority badge colors
 */
export function getPriorityBadgeClassName(priority: MessagePriority): string {
  switch (priority) {
    case 'low':
      return 'text-status-neutral-text bg-status-neutral-bg border-status-neutral-border'
    case 'normal':
      return 'text-status-info-text bg-status-info-bg border-status-info-border'
    case 'high':
      return 'text-status-warning-text bg-status-warning-bg border-status-warning-border'
    case 'urgent':
      return 'text-status-error-text bg-status-error-bg border-status-error-border'
    default:
      return 'text-status-info-text bg-status-info-bg border-status-info-border'
  }
}

/**
 * Get the localized priority label key
 */
export function getPriorityLabelKey(priority: MessagePriority): string {
  return `messages.priority.${priority}`
}

/**
 * Get the default fallback label for a priority
 */
export function getPriorityFallbackLabel(priority: MessagePriority): string {
  switch (priority) {
    case 'low':
      return 'Low'
    case 'normal':
      return 'Normal'
    case 'high':
      return 'High'
    case 'urgent':
      return 'Urgent'
    default:
      return 'Normal'
  }
}

/**
 * Get all available priority options for dropdowns/selects
 */
export function getPriorityOptions(): Array<{ value: MessagePriority; labelKey: string; fallbackLabel: string }> {
  return [
    { value: 'low', labelKey: getPriorityLabelKey('low'), fallbackLabel: getPriorityFallbackLabel('low') },
    { value: 'normal', labelKey: getPriorityLabelKey('normal'), fallbackLabel: getPriorityFallbackLabel('normal') },
    { value: 'high', labelKey: getPriorityLabelKey('high'), fallbackLabel: getPriorityFallbackLabel('high') },
    { value: 'urgent', labelKey: getPriorityLabelKey('urgent'), fallbackLabel: getPriorityFallbackLabel('urgent') },
  ]
}