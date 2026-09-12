'use client'

import * as React from 'react'
import { AlertTriangle, Clock } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { getTimeAgoParts, isAppointmentOverdue } from '../lib/urgency'

function useNow(intervalMs = 60_000) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

type AppointmentUrgencyCellProps = {
  createdAt: string
  statusCode: string
}

export function AppointmentUrgencyCell({ createdAt, statusCode }: AppointmentUrgencyCellProps) {
  const t = useT()
  const now = useNow()
  const overdue = isAppointmentOverdue(statusCode, createdAt, now)
  const isNewRequest = statusCode === 'new_request'
  const parts = getTimeAgoParts(createdAt, now)

  let label = t('appointments.list.noValue')
  if (parts?.kind === 'just_now') {
    label = t('appointments.list.urgency.justNow', 'Just now')
  } else if (parts?.kind === 'minutes') {
    label =
      parts.count === 1
        ? t('appointments.list.urgency.minuteAgo', '1 min ago')
        : t('appointments.list.urgency.minutesAgo', '{count} mins ago', { count: parts.count })
  } else if (parts?.kind === 'hours') {
    label =
      parts.count === 1
        ? t('appointments.list.urgency.hourAgo', '1 hr ago')
        : t('appointments.list.urgency.hoursAgo', '{count} hrs ago', { count: parts.count })
  } else if (parts?.kind === 'days') {
    label =
      parts.count === 1
        ? t('appointments.list.urgency.dayAgo', '1 day ago')
        : t('appointments.list.urgency.daysAgo', '{count} days ago', { count: parts.count })
  }

  const createdTitle = (() => {
    try {
      return new Date(createdAt).toLocaleString()
    } catch {
      return createdAt
    }
  })()

  return (
    <div
      className={cn(
        'inline-flex max-w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1',
        overdue && 'border-status-error-border bg-status-error-bg text-status-error-text',
        !overdue &&
          isNewRequest &&
          'border-status-warning-border bg-status-warning-bg text-status-warning-text',
        !overdue &&
          !isNewRequest &&
          'border-status-neutral-border bg-status-neutral-bg text-foreground',
      )}
      title={t('appointments.list.urgency.createdAt', 'Created: {value}', { value: createdTitle })}
    >
      {overdue ? (
        <span className="relative inline-flex shrink-0" aria-hidden="true">
          <AlertTriangle className="size-3.5 animate-pulse text-status-error-icon" />
          <span className="absolute inset-0 size-3.5 animate-ping rounded-full bg-status-error-icon/40" />
        </span>
      ) : (
        <Clock
          className={cn(
            'size-3.5 shrink-0',
            isNewRequest ? 'text-status-warning-icon' : 'text-muted-foreground',
          )}
          aria-hidden="true"
        />
      )}
      <span
        className={cn(
          'whitespace-nowrap text-xs',
          overdue || isNewRequest ? 'font-semibold' : 'font-medium',
        )}
      >
        {label}
      </span>
    </div>
  )
}
