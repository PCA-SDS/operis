'use client'

import * as React from 'react'
import { formatDistance } from 'date-fns'
import { cn } from '@open-mercato/shared/lib/utils'
import { shouldShowArrivalInfo } from '../lib/urgency'

function useNow(intervalMs = 60_000) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

type AppointmentArrivalInfoProps = {
  requestedStartAt: string
  statusCode: string
}

export function AppointmentArrivalInfo({
  requestedStartAt,
  statusCode,
}: AppointmentArrivalInfoProps) {
  const now = useNow()
  if (!shouldShowArrivalInfo(statusCode)) return null

  const bookingTime = new Date(requestedStartAt)
  if (Number.isNaN(bookingTime.getTime())) return null

  const isFuture = bookingTime.getTime() > now
  const text = formatDistance(bookingTime, now, { addSuffix: true })

  return (
    <div
      className={cn(
        'mt-1 inline-flex max-w-full rounded-sm px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        isFuture
          ? 'bg-status-info-bg text-status-info-text'
          : 'bg-status-error-bg text-status-error-text',
      )}
    >
      {text}
    </div>
  )
}
