"use client"

import * as React from 'react'
import { StatusBadge, type StatusBadgeVariant, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import {
  APPOINTMENT_SYSTEM_STATUS_CODES,
  type AppointmentSystemStatusCode,
} from '../data/constants'

export const APPOINTMENT_STATUS_BADGE_VARIANTS: StatusMap<AppointmentSystemStatusCode> = {
  new_request: 'info',
  in_progress: 'warning',
  booked: 'success',
  cancelled: 'error',
}

function isSystemStatus(value: string): value is AppointmentSystemStatusCode {
  return (APPOINTMENT_SYSTEM_STATUS_CODES as readonly string[]).includes(value)
}

export function getAppointmentStatusBadgeVariant(statusCode: string): StatusBadgeVariant {
  if (isSystemStatus(statusCode)) return APPOINTMENT_STATUS_BADGE_VARIANTS[statusCode]
  return 'neutral'
}

export function AppointmentStatusBadge({
  statusCode,
  label,
  dot = true,
  className,
}: {
  statusCode: string
  /** Prefer catalog label from `/api/appointments/statuses`; falls back to code. */
  label?: string | null
  dot?: boolean
  className?: string
}) {
  return (
    <StatusBadge
      variant={getAppointmentStatusBadgeVariant(statusCode)}
      dot={dot}
      className={className}
    >
      {label?.trim() || statusCode}
    </StatusBadge>
  )
}
