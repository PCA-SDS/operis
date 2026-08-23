"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TaskStatus } from '../data/types'
import { TASK_STATUS_META } from './format'

/**
 * The status glyph. Each state reads at a glance without colour alone doing the
 * work: backlog is a dashed outline (nothing started), in-progress and review
 * are pie wedges that fill as work advances, blocked is a solid stop, done is a
 * filled tick, cancelled is a muted cross.
 */
export function StatusIcon({
  status,
  className = 'size-4',
}: {
  status: TaskStatus
  className?: string
}) {
  const t = useT()
  const meta = TASK_STATUS_META[status]
  const color = meta.colorVar
  const muted = 'var(--disabled-foreground)'

  let inner: React.ReactNode = null
  let ring: React.ReactNode = (
    <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="1.75" />
  )

  if (status === 'done') {
    ring = <circle cx="8" cy="8" r="7" fill={color} />
    inner = (
      <path
        d="M5 8.2 L7 10.2 L11 5.8"
        fill="none"
        stroke="var(--status-success-bg)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )
  } else if (status === 'cancelled') {
    ring = <circle cx="8" cy="8" r="6" fill="none" stroke={muted} strokeWidth="1.75" />
    inner = (
      <path
        d="M5.8 5.8 L10.2 10.2 M10.2 5.8 L5.8 10.2"
        stroke={muted}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    )
  } else if (status === 'backlog') {
    ring = (
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke={muted}
        strokeWidth="1.75"
        strokeDasharray="2.3 2.3"
      />
    )
  } else if (status === 'blocked') {
    inner = <circle cx="8" cy="8" r="2.4" fill={color} />
  } else if (status === 'in_progress' || status === 'review') {
    const fraction = status === 'in_progress' ? 0.5 : 0.82
    ring = <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="1.75" opacity="0.35" />
    inner = <path d={wedge(fraction)} fill={color} />
  }

  const label = t('tasks.status.label', 'Status: {status}', {
    status: t(meta.labelKey, meta.fallback),
  })

  return (
    <svg viewBox="0 0 16 16" className={`shrink-0 ${className}`} role="img" aria-label={label}>
      {ring}
      {inner}
    </svg>
  )
}

/** Pie wedge from 12 o'clock, clockwise, covering `fraction` of the circle. */
function wedge(fraction: number): string {
  const radius = 4
  const angle = fraction * 2 * Math.PI
  const x = 8 + radius * Math.sin(angle)
  const y = 8 - radius * Math.cos(angle)
  const largeArc = fraction > 0.5 ? 1 : 0
  return `M8 8 L8 ${8 - radius} A ${radius} ${radius} 0 ${largeArc} 1 ${x.toFixed(3)} ${y.toFixed(3)} Z`
}
