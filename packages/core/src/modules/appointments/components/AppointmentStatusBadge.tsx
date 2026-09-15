"use client"

import * as React from 'react'
import { StatusBadge, type StatusBadgeVariant, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import {
  APPOINTMENT_SYSTEM_STATUS_CODES,
  type AppointmentSystemStatusCode,
} from '../data/constants'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export const APPOINTMENT_STATUS_BADGE_VARIANTS: StatusMap<AppointmentSystemStatusCode> = {
  new_request: 'info',
  in_progress: 'warning',
  booked: 'success',
  cancelled: 'error',
}

const APPOINTMENT_IMPORTED_STATUS_BADGE_VARIANTS: Record<string, StatusBadgeVariant> = {
  booked_non_deposit: 'success',
  deposit_received_booked: 'success',
  replied: 'info',
  replied_need_to_follow_up: 'warning',
  send_deposit_email: 'warning',
  sent_deposit_rq_need_to_check: 'warning',
}

function isSystemStatus(value: string): value is AppointmentSystemStatusCode {
  return (APPOINTMENT_SYSTEM_STATUS_CODES as readonly string[]).includes(value)
}

export function getAppointmentStatusBadgeVariant(statusCode: string): StatusBadgeVariant {
  if (isSystemStatus(statusCode)) return APPOINTMENT_STATUS_BADGE_VARIANTS[statusCode]
  return APPOINTMENT_IMPORTED_STATUS_BADGE_VARIANTS[statusCode] ?? 'neutral'
}

export function AppointmentStatusBadge({
    statusCode,
    label,
    backgroundColor,
    textColor,
    dot = true,
  className,
}: {
  statusCode: string
  /** Prefer catalog label from `/api/appointments/statuses`; falls back to code. */
  label?: string | null
  backgroundColor?: string | null
  textColor?: string | null
  dot?: boolean
  className?: string
}) {
  const t = useT()
  const defaultLabel = statusCode === 'new_request'
    ? t('appointments.status.newRequest', 'New request')
    : statusCode === 'in_progress'
      ? t('appointments.status.inProgress', 'In progress')
      : statusCode === 'booked'
        ? t('appointments.status.booked', 'Booked')
        : statusCode === 'cancelled'
          ? t('appointments.status.cancelled', 'Cancelled')
          : null

  return (
    <StatusBadge
      variant={getAppointmentStatusBadgeVariant(statusCode)}
      dot={dot}
      backgroundColor={backgroundColor}
      textColor={textColor}
      className={className}
    >
      {label?.trim() || defaultLabel || statusCode}
    </StatusBadge>
  )
}
