'use client'

import * as React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AppointmentStatusBadge } from './AppointmentStatusBadge'

export type AppointmentStatusOption = {
  code: string
  label: string
}

type AppointmentStatusSelectProps = {
  appointmentId: string
  statusCode: string
  statuses: AppointmentStatusOption[]
  /** Optimistic / parent row sync after a successful (or optimistic) change. */
  onStatusChange?: (statusCode: string) => void
  disabled?: boolean
  className?: string
}

export function AppointmentStatusSelect({
  appointmentId,
  statusCode,
  statuses,
  onStatusChange,
  disabled = false,
  className,
}: AppointmentStatusSelectProps) {
  const t = useT()
  const [isSaving, setIsSaving] = React.useState(false)
  const { runMutation } = useGuardedMutation({
    contextId: 'appointments.list.status',
  })

  const selectedLabel =
    statuses.find((status) => status.code === statusCode)?.label ?? statusCode

  const handleValueChange = React.useCallback(
    async (nextCode: string) => {
      if (!nextCode || nextCode === statusCode || isSaving) return
      const previousCode = statusCode
      onStatusChange?.(nextCode)
      setIsSaving(true)
      try {
        await runMutation({
          operation: async () => {
            const call = await apiCall<{ id?: string; statusCode?: string; error?: string }>(
              `/api/appointments/${encodeURIComponent(appointmentId)}`,
              {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ statusCode: nextCode }),
              },
              { fallback: null },
            )
            if (!call.ok || !call.result?.id) {
              const errorPayload = call.result as { error?: string } | undefined
              throw new Error(
                typeof errorPayload?.error === 'string'
                  ? errorPayload.error
                  : t('appointments.status.failed'),
              )
            }
            return call.result
          },
          context: {},
        })
        flash(t('appointments.detail.statusSaved'), 'success')
      } catch (error) {
        onStatusChange?.(previousCode)
        flash(
          error instanceof Error ? error.message : t('appointments.status.failed'),
          'error',
        )
      } finally {
        setIsSaving(false)
      }
    },
    [appointmentId, isSaving, onStatusChange, runMutation, statusCode, t],
  )

  return (
    <div
      className={className}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Select
        value={statusCode || undefined}
        onValueChange={(value) => {
          void handleValueChange(value)
        }}
        disabled={disabled || isSaving || statuses.length === 0}
      >
        <SelectTrigger className="h-auto min-w-[10rem] gap-1 rounded-md border border-border bg-surface px-2 py-1 shadow-sm">
          <SelectValue placeholder={t('appointments.list.columns.status')}>
            {statusCode ? (
              <AppointmentStatusBadge
                statusCode={statusCode}
                label={selectedLabel}
                className="border font-medium"
              />
            ) : null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {statuses.map((status) => (
            <SelectItem key={status.code} value={status.code}>
              <AppointmentStatusBadge statusCode={status.code} label={status.label} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
