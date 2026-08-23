"use client"

import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TaskPriority } from '../data/types'
import { TASK_PRIORITY_META } from './format'

/** How many of the three bars are lit. `urgent` shares `high`'s full stack and
 *  separates itself by colour — a fourth bar would break the signal-strength
 *  metaphor. */
const FILLED: Record<TaskPriority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 3,
}

const BARS = [
  { x: 1.5, height: 5 },
  { x: 6, height: 9 },
  { x: 10.5, height: 13 },
]

export function PriorityBars({
  priority,
  className = 'size-4',
}: {
  priority: TaskPriority
  className?: string
}) {
  const t = useT()
  const meta = TASK_PRIORITY_META[priority]
  const filled = FILLED[priority]
  const label = t('tasks.priority.label', 'Priority: {priority}', {
    priority: t(meta.labelKey, meta.fallback),
  })

  return (
    <svg viewBox="0 0 16 16" className={`shrink-0 ${className}`} role="img" aria-label={label}>
      {BARS.map((bar, index) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={15 - bar.height}
          width="3"
          height={bar.height}
          rx="1"
          fill={index < filled ? meta.colorVar : 'var(--surface-strong)'}
        />
      ))}
    </svg>
  )
}
