'use client'

import * as React from 'react'
import { Check, Clock, MapPin, Minus, Plus, Search, Users, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type AppointmentStaffAssignmentTarget = {
  serviceName: string
  resourceName?: string | null
  startsAt: string
  endsAt: string
  assignedMemberId?: string | null
  assignedMemberName?: string | null
  assignedMemberIds?: string[]
  assignedMemberNames?: string[]
}

export type AppointmentAssignableStaff = {
  id: string
  displayName: string
  roleLabel: string
  roleLabels?: string[]
}

const SLOT_MINUTES = 15
const MIN_DURATION = 15
const MAX_DURATION = 480

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function durationMinutes(target: AppointmentStaffAssignmentTarget) {
  return Math.max(MIN_DURATION, Math.round((new Date(target.endsAt).getTime() - new Date(target.startsAt).getTime()) / 60000))
}

function assignedMemberIdsFor(target: AppointmentStaffAssignmentTarget) {
  if (Array.isArray(target.assignedMemberIds) && target.assignedMemberIds.length > 0) return target.assignedMemberIds
  return target.assignedMemberId ? [target.assignedMemberId] : []
}

export function AppointmentStaffAssignmentSheet({
  target,
  staff,
  isLoadingStaff,
  isLoadingMoreStaff,
  hasMoreStaff,
  busyStaffIds,
  isSaving,
  onClose,
  onAssign,
  onDurationChange,
  onLoadMore,
}: {
  target: AppointmentStaffAssignmentTarget | null
  staff: AppointmentAssignableStaff[]
  isLoadingStaff: boolean
  isLoadingMoreStaff: boolean
  hasMoreStaff: boolean
  busyStaffIds: Set<string>
  isSaving: boolean
  onClose: () => void
  onAssign: (staffId: string | null) => void
  onDurationChange: (duration: number) => void
  onLoadMore: () => void
}) {
  const t = useT()
  const hasTarget = Boolean(target)
  const [isVisible, setIsVisible] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const resultsRef = React.useRef<HTMLDivElement>(null)
  const duration = target ? durationMinutes(target) : MIN_DURATION
  const assignedMemberIds = target ? assignedMemberIdsFor(target) : []
  const filteredStaff = React.useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return staff
    return staff.filter((member) => `${member.displayName} ${member.roleLabel} ${(member.roleLabels ?? []).join(' ')}`.toLowerCase().includes(value))
  }, [query, staff])

  React.useEffect(() => {
    if (!hasTarget) {
      setIsVisible(false)
      return
    }
    const frame = window.requestAnimationFrame(() => setIsVisible(true))
    return () => window.cancelAnimationFrame(frame)
  }, [hasTarget])

  if (!target) return null

  return (
    <div data-appointment-staff-assignment-sheet="true" className={`fixed inset-0 z-50 flex justify-end bg-scrim transition-opacity duration-150 ease-out ${isVisible ? 'opacity-100' : 'opacity-0'}`} onClick={onClose}>
      <aside className={`flex h-full w-full max-w-md flex-col bg-surface shadow-lg transition-transform duration-150 ease-out will-change-transform ${isVisible ? 'translate-x-0' : 'translate-x-full'}`} onClick={(event) => event.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{t('appointments.staffAssignment.title', 'Assign staff')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('appointments.staffAssignment.hint', 'Choose staff for this service and time window.')}</p>
          </div>
          <IconButton type="button" variant="ghost" aria-label={t('common.close', 'Close')} onClick={onClose}><X className="size-4" /></IconButton>
        </div>

        <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-2">
          <p className="text-sm font-semibold">{target.serviceName}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {target.resourceName ? <><span className="flex items-center gap-1"><MapPin className="size-3.5" />{target.resourceName}</span><span aria-hidden="true">•</span></> : null}
            <span className="flex items-center gap-1"><Clock className="size-3.5" />{formatTime(target.startsAt)} - {formatTime(target.endsAt)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('appointments.staffAssignment.duration', 'Duration')}</p>
              <p className="mt-0.5 text-sm font-semibold">{duration} min</p>
            </div>
            <div className="flex items-center gap-2">
              <IconButton type="button" size="sm" variant="outline" aria-label={t('appointments.staffAssignment.decreaseDuration', 'Decrease duration')} disabled={duration <= MIN_DURATION || isSaving} onClick={() => onDurationChange(Math.max(MIN_DURATION, duration - SLOT_MINUTES))}><Minus className="size-4" /></IconButton>
              <IconButton type="button" size="sm" variant="outline" aria-label={t('appointments.staffAssignment.increaseDuration', 'Increase duration')} disabled={duration >= MAX_DURATION || isSaving} onClick={() => onDurationChange(Math.min(MAX_DURATION, duration + SLOT_MINUTES))}><Plus className="size-4" /></IconButton>
            </div>
          </div>
          {assignedMemberIds.length > 0 ? (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-1.5">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('appointments.staffAssignment.assigned', 'Staff assigned')}</p>
                <p className="line-clamp-2 break-words text-sm font-semibold leading-tight">{(target.assignedMemberNames ?? (target.assignedMemberName ? [target.assignedMemberName] : [])).join(', ') || t('appointments.staffAssignment.member', 'Staff member')}</p>
              </div>
              <IconButton type="button" size="sm" variant="ghost" aria-label={t('appointments.staffAssignment.remove', 'Remove staff')} disabled={isSaving} onClick={() => onAssign(null)}><X className="size-4" /></IconButton>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 border-b border-border p-3">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} leftIcon={<Search className="size-4" />} placeholder={t('appointments.staffAssignment.search', 'Search staff...')} />
        </div>
        <div ref={resultsRef} className="min-h-0 flex-1 overflow-y-auto p-3" onScroll={(event) => {
          const element = event.currentTarget
          if (element.scrollHeight - element.scrollTop - element.clientHeight < 96 && hasMoreStaff && !isLoadingMoreStaff) onLoadMore()
        }}>
          <div className="space-y-3">
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('appointments.staffAssignment.list', 'Staff list')}</p>
            {isLoadingStaff ? <p className="p-3 text-sm text-muted-foreground">{t('appointments.staffAssignment.loading', 'Loading staff...')}</p> : null}
            {!isLoadingStaff && filteredStaff.length === 0 ? <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground"><span className="flex size-10 items-center justify-center rounded-full bg-muted"><Users className="size-5" /></span><p className="text-sm">{t('appointments.staffAssignment.empty', 'No assignable staff found.')}</p></div> : null}
            {filteredStaff.map((member) => {
              const busy = busyStaffIds.has(member.id)
              const active = assignedMemberIds.includes(member.id)
              return <Button key={member.id} type="button" variant="ghost" aria-pressed={active} className={`h-auto w-full justify-start gap-3 rounded-md border p-3 text-left ${active ? 'border-primary bg-primary/5' : 'border-border bg-surface hover:bg-muted/40'}`} disabled={isSaving} onClick={() => onAssign(member.id)}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{member.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{member.displayName}</span><span className="mt-1 flex flex-wrap gap-1">
                  {busy ? <Tag variant="warning">{t('appointments.staffAssignment.busy', 'Busy')}</Tag> : null}
                  {!busy && (member.roleLabels ?? []).length > 0 ? (member.roleLabels ?? []).map((role) => <Tag key={role} variant="neutral">{role}</Tag>) : null}
                  {!busy && (member.roleLabels ?? []).length === 0 ? <Tag variant="neutral">{member.roleLabel}</Tag> : null}
                </span></span>
                <span className={`flex size-5 shrink-0 items-center justify-center rounded-sm border ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface'}`}>{active ? <Check className="size-3.5" /> : null}</span>
              </Button>
            })}
            {isLoadingMoreStaff ? <p className="px-3 py-2 text-center text-xs text-muted-foreground">{t('appointments.staffAssignment.loadingMore', 'Loading more staff...')}</p> : null}
          </div>
        </div>
      </aside>
    </div>
  )
}
