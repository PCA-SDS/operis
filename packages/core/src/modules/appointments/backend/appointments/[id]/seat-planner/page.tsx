"use client"

import * as React from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Check,
  Clock,
  Menu,
  Minus,
  PanelLeftClose,
  Plus,
  Search,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { AppointmentStatusBadge } from '@open-mercato/core/modules/appointments/components/AppointmentStatusBadge'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { resolveRegisteredLucideIconNode } from '@open-mercato/ui/backend/icons/lucideRegistry'

const START_HOUR = 8
const END_HOUR = 22
const SLOT_MINUTES = 15
const HOUR_HEIGHT = 88
const HEADER_HEIGHT = 80
const TIME_COLUMN_WIDTH = 72
const SEAT_COLUMN_WIDTH = 184
const MIN_DURATION = 15
const MAX_DURATION = 480

type SeatPlannerLine = {
  id: string
  productTitle: string
  durationMinutes: number | null
  currentAssignment?: {
    id: string
    state: 'draft' | 'confirmed'
    resourceId: string
    resourceName?: string | null
    startsAt: string
    endsAt: string
    assignedMemberId?: string | null
    assignedMemberName?: string | null
  }
}

type Resource = {
  id: string
  name: string
  code?: string | null
  appearanceIcon?: string | null
  capacityUnitIcon?: string | null
  capacityUnitColor?: string | null
  areaName?: string | null
  typeName?: string | null
  typeIcon?: string | null
  typeColor?: string | null
}

type SeatPlannerWorkspace = {
  appointment: {
    id: string
    customerName: string
    requestedStartAt: string
    requestedEndAt: string | null
    statusCode: string
  }
  lines: SeatPlannerLine[]
  allocations: PlannerAllocation[]
  resources: Resource[]
}

type PlannerAllocation = {
  id: string
  appointmentId: string
  lineId: string
  resourceId: string
  resourceName?: string | null
  serviceName: string
  customerName: string
  startsAt: string
  endsAt: string
  state: 'draft' | 'confirmed'
  assignedMemberId?: string | null
  assignedMemberName?: string | null
  laneIndex: number
  lanesCount: number
}

type StaffMember = { id: string; displayName: string; roleLabel: string }
type PopoverState = { allocation: PlannerAllocation; anchor: DOMRect }
type StaffSheetTarget = { allocation: PlannerAllocation; line: SeatPlannerLine | null }

interface SeatPlannerPageProps {
  params?: { id?: string }
}

const mockStaff: StaffMember[] = [
  { id: 'mock-staff-1', displayName: 'Linh Nguyen', roleLabel: 'Senior stylist' },
  { id: 'mock-staff-2', displayName: 'Minh Tran', roleLabel: 'Nail artist' },
  { id: 'mock-staff-3', displayName: 'Anh Pham', roleLabel: 'Technician' },
  { id: 'mock-staff-4', displayName: 'Vy Hoang', roleLabel: 'Assistant' },
]

function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function timeToMinutes(value: string): number {
  const [hour = '0', minute = '0'] = value.split(':')
  return Number(hour) * 60 + Number(minute)
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function durationMinutes(startsAt: string, endsAt: string): number {
  return Math.max(MIN_DURATION, Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000))
}

function lineDuration(line: SeatPlannerLine | null | undefined): number {
  return Math.max(MIN_DURATION, line?.durationMinutes ?? 60)
}

function slotHeight(): number {
  return HOUR_HEIGHT / (60 / SLOT_MINUTES)
}

function slotTop(time: string): number {
  return ((timeToMinutes(time) - START_HOUR * 60) / SLOT_MINUTES) * slotHeight()
}

function allocationTop(allocation: PlannerAllocation): number {
  const date = new Date(allocation.startsAt)
  return (((date.getHours() * 60 + date.getMinutes()) - START_HOUR * 60) / SLOT_MINUTES) * slotHeight()
}

function allocationHeight(allocation: PlannerAllocation): number {
  return Math.max((durationMinutes(allocation.startsAt, allocation.endsAt) / SLOT_MINUTES) * slotHeight(), 24)
}

function buildIsoFromSlot(baseIso: string, time: string): string {
  const date = new Date(baseIso)
  const [hour = '0', minute = '0'] = time.split(':')
  date.setHours(Number(hour), Number(minute), 0, 0)
  return date.toISOString()
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString()
}

function snapDuration(value: number): number {
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(value / SLOT_MINUTES) * SLOT_MINUTES))
}

function buildSlots(): string[] {
  const slots: string[] = []
  for (let minutes = START_HOUR * 60; minutes < END_HOUR * 60; minutes += SLOT_MINUTES) slots.push(minutesToTime(minutes))
  return slots
}

function buildTimeMarkers(): string[] {
  const markers: string[] = []
  for (let hour = START_HOUR; hour <= END_HOUR; hour += 1) markers.push(minutesToTime(hour * 60))
  return markers
}

function groupResources(resources: Resource[]): Array<Resource & { floorName: string; isFirstInFloor: boolean }> {
  const groups = new Map<string, Resource[]>()
  for (const resource of resources) {
    const floorName = resource.areaName || 'Main floor'
    groups.set(floorName, [...(groups.get(floorName) ?? []), resource])
  }
  return [...groups.entries()].flatMap(([floorName, values]) =>
    values.map((resource, index) => ({ ...resource, floorName, isFirstInFloor: index === 0 })),
  )
}

function ResourceIcon({ resource }: { resource: Resource }) {
  const iconName = resource.appearanceIcon ?? resource.capacityUnitIcon ?? resource.typeIcon ?? null
  const iconNode = resolveRegisteredLucideIconNode(iconName ?? undefined, 'size-4')
  if (iconNode) return iconNode
  if (iconName) return <span className="text-sm leading-none" aria-hidden="true">{iconName}</span>
  return <span className="text-xs font-semibold text-muted-foreground" aria-hidden="true">{(resource.code || resource.name).slice(0, 2).toUpperCase()}</span>
}

function computeLanes(allocations: PlannerAllocation[]): PlannerAllocation[] {
  const sorted = [...allocations].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
  const laneEnds: number[] = []
  const result = sorted.map((allocation) => {
    const start = new Date(allocation.startsAt).getTime()
    const end = new Date(allocation.endsAt).getTime()
    const openLane = laneEnds.findIndex((laneEnd) => laneEnd <= start)
    const laneIndex = openLane >= 0 ? openLane : laneEnds.length
    laneEnds[laneIndex] = end
    return { ...allocation, laneIndex, lanesCount: 1 }
  })
  const lanesCount = Math.max(1, laneEnds.length)
  return result.map((allocation) => ({ ...allocation, lanesCount }))
}

function blockTone(isOwn: boolean, isActive: boolean, state: 'draft' | 'confirmed'): string {
  if (!isOwn) return 'border-border bg-muted text-muted-foreground'
  if (isActive) return 'border-primary bg-primary text-primary-foreground shadow-md'
  if (state === 'confirmed') return 'border-status-success-border bg-status-success-bg text-status-success-text'
  return 'border-status-info-border bg-status-info-bg text-status-info-text'
}

function LegendBar({ earliestTime }: { earliestTime: string }) {
  const t = useT()
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5 font-medium text-status-warning-text">
        <span className="h-0.5 w-4 bg-status-warning-icon" />
        {t('appointments.seatPlanner.earliest', 'Earliest')}: {earliestTime}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm bg-muted" />
        {t('appointments.seatPlanner.beforeEarliest', 'Before earliest')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-primary" />
        {t('appointments.seatPlanner.yourBooking', 'Your booking')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-status-neutral-icon" />
        {t('appointments.seatPlanner.existingBooking', 'Existing booking')}
      </span>
    </div>
  )
}

function PlannerBlock(props: {
  allocation: PlannerAllocation
  line: SeatPlannerLine | null
  isOwn: boolean
  isActive: boolean
  onResizeEnd: (duration: number) => Promise<void>
  onOpen: (event: React.MouseEvent<HTMLDivElement>) => void
}) {
  const { allocation, line, isOwn, isActive, onResizeEnd, onOpen } = props
  const [dragDuration, setDragDuration] = React.useState<number | null>(null)
  const currentDuration = durationMinutes(allocation.startsAt, allocation.endsAt)
  const startYRef = React.useRef(0)
  const startDurationRef = React.useRef(currentDuration)
  const nextDurationRef = React.useRef(currentDuration)
  const displayDuration = dragDuration ?? currentDuration
  const laneWidth = 100 / allocation.lanesCount

  const handleResizePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isOwn) return
    event.preventDefault()
    event.stopPropagation()
    startYRef.current = event.clientY
    startDurationRef.current = currentDuration
    nextDurationRef.current = currentDuration
    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextDuration = snapDuration(startDurationRef.current + ((moveEvent.clientY - startYRef.current) / slotHeight()) * SLOT_MINUTES)
      nextDurationRef.current = nextDuration
      setDragDuration(nextDuration)
    }
    const onPointerEnd = async () => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerEnd)
      document.removeEventListener('pointercancel', onPointerEnd)
      setDragDuration(null)
      if (nextDurationRef.current !== currentDuration) await onResizeEnd(nextDurationRef.current)
    }
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerEnd)
    document.addEventListener('pointercancel', onPointerEnd)
  }, [currentDuration, isOwn, onResizeEnd])

  return (
    <div
      role="button"
      tabIndex={0}
      className={`absolute z-20 flex cursor-pointer flex-col overflow-hidden rounded-md border px-2 py-1 text-xs transition hover:ring-2 hover:ring-primary/40 ${blockTone(isOwn, isActive, allocation.state)}`}
      style={{
        top: allocationTop(allocation),
        height: Math.max((displayDuration / SLOT_MINUTES) * slotHeight(), 24),
        left: `calc(4px + ${allocation.laneIndex} * ${laneWidth}%)`,
        width: `calc(${laneWidth}% - 8px)`,
      }}
      onClick={(event) => {
        event.stopPropagation()
        onOpen(event)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onOpen(event as unknown as React.MouseEvent<HTMLDivElement>)
      }}
    >
      <span className="line-clamp-2 font-semibold leading-tight">{allocation.serviceName}</span>
      <span className="truncate text-xs opacity-80">{allocation.assignedMemberName || line?.currentAssignment?.assignedMemberName || 'No staff assigned'}</span>
      <span className="mt-auto truncate text-xs opacity-80">{formatTime(allocation.startsAt)} - {formatTime(addMinutes(allocation.startsAt, displayDuration))}</span>
      {isOwn ? (
        <div className="absolute inset-x-0 bottom-0 h-3 cursor-row-resize bg-foreground/10" onPointerDown={handleResizePointerDown} onClick={(event) => event.stopPropagation()} />
      ) : null}
    </div>
  )
}

function BookingSidebar(props: {
  workspace: SeatPlannerWorkspace
  activeLineId: string | null
  canManage: boolean
  isSaving: boolean
  onSelectLine: (lineId: string) => void
  onClearLine: (lineId: string) => void
  onPreviewAction: () => void
}) {
  const { workspace, activeLineId, canManage, isSaving, onSelectLine, onClearLine, onPreviewAction } = props
  const t = useT()
  const assigned = workspace.lines.filter((line) => line.currentAssignment).length
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="shrink-0 border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{workspace.appointment.customerName}</p>
            <p className="mt-1 text-sm text-muted-foreground">{formatDate(workspace.appointment.requestedStartAt)}</p>
          </div>
          <AppointmentStatusBadge statusCode={workspace.appointment.statusCode} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground">{t('appointments.seatPlanner.services', 'Services')}</p>
            <p className="mt-1 font-semibold">{workspace.lines.length}</p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground">{t('appointments.seatPlanner.assigned', 'Assigned')}</p>
            <p className="mt-1 font-semibold">{assigned}</p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button type="button" size="sm" variant="outline" className="flex-1" onClick={onPreviewAction}>{t('appointments.seatPlanner.edit', 'Edit')}</Button>
          <Button type="button" size="sm" variant="outline" className="flex-1" onClick={onPreviewAction}>{t('appointments.seatPlanner.payment', 'Payment')}</Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{t('appointments.seatPlanner.serviceQueue', 'Service queue')}</p>
            <p className="text-xs text-muted-foreground">{t('appointments.seatPlanner.selectServiceHint', 'Select a service, then click a seat slot.')}</p>
          </div>
          <IconButton type="button" size="sm" variant="outline" aria-label={t('appointments.seatPlanner.addService', 'Add service')} onClick={onPreviewAction}>
            <Plus className="size-4" />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-2">
            {workspace.lines.map((line, index) => {
              const active = line.id === activeLineId
              return (
                <div
                  key={line.id}
                  role="button"
                  tabIndex={0}
                  className={`rounded-md border p-3 transition ${active ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-surface hover:bg-muted/40'}`}
                  onClick={() => onSelectLine(line.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') onSelectLine(line.id)
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{index + 1}</span>
                        <p className="line-clamp-2 text-sm font-semibold">{line.productTitle}</p>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {lineDuration(line)} min{line.currentAssignment?.resourceName ? `, ${line.currentAssignment.resourceName}` : ''}
                      </p>
                    </div>
                    <Tag variant={line.currentAssignment ? (line.currentAssignment.state === 'confirmed' ? 'success' : 'info') : 'neutral'}>
                      {line.currentAssignment ? line.currentAssignment.state : t('appointments.seatPlanner.unassigned', 'Unassigned')}
                    </Tag>
                  </div>
                  {line.currentAssignment ? (
                    <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
                      <span className="truncate">{formatTime(line.currentAssignment.startsAt)} - {formatTime(line.currentAssignment.endsAt)}</span>
                      {canManage && line.currentAssignment.state === 'draft' ? (
                        <IconButton
                          type="button"
                          size="xs"
                          variant="ghost"
                          aria-label={t('appointments.seatPlanner.clearDraft', 'Clear draft')}
                          disabled={isSaving}
                          onClick={(event) => {
                            event.stopPropagation()
                            onClearLine(line.id)
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function DraftPopover(props: {
  state: PopoverState
  line: SeatPlannerLine | null
  isOwn: boolean
  onClose: () => void
  onClear: () => void
  onDurationChange: (duration: number) => void
  onOpenStaff: () => void
}) {
  const { state, line, isOwn, onClose, onClear, onDurationChange, onOpenStaff } = props
  const t = useT()
  const allocation = state.allocation
  const currentDuration = durationMinutes(allocation.startsAt, allocation.endsAt)
  const [rawDuration, setRawDuration] = React.useState(String(currentDuration))

  React.useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  const commitDuration = () => {
    const next = Number(rawDuration)
    if (Number.isFinite(next) && next > 0 && next !== currentDuration) onDurationChange(snapDuration(next))
    else setRawDuration(String(currentDuration))
  }

  const left = Math.min(Math.max(12, state.anchor.right + 12), Math.max(12, window.innerWidth - 320))
  const top = Math.min(Math.max(12, state.anchor.top), Math.max(12, window.innerHeight - 280))

  return (
    <div role="dialog" className="fixed z-50 w-80 rounded-lg border border-border bg-surface shadow-lg" style={{ left, top }} onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{allocation.serviceName}</p>
          <p className="mt-1 text-xs text-muted-foreground">{allocation.resourceName ?? line?.currentAssignment?.resourceName}</p>
        </div>
        <IconButton type="button" size="sm" variant="ghost" aria-label={t('common.close', 'Close')} onClick={onClose}><X className="size-4" /></IconButton>
      </div>
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-3 text-sm">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">{t('appointments.seatPlanner.time', 'Time')}</p>
            <p className="mt-1 font-semibold">{formatTime(allocation.startsAt)} - {formatTime(allocation.endsAt)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">{t('appointments.seatPlanner.duration', 'Duration')}</p>
            {isOwn ? (
              <Input
                type="number"
                size="sm"
                value={rawDuration}
                onChange={(event) => setRawDuration(event.target.value)}
                onBlur={commitDuration}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitDuration()
                }}
                rightIcon={<span className="text-xs">min</span>}
              />
            ) : <p className="mt-1 font-semibold">{currentDuration} min</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <UserRound className="size-4 text-muted-foreground" />
          <span className={allocation.assignedMemberName ? 'font-medium' : 'font-medium text-status-warning-text'}>
            {allocation.assignedMemberName || t('appointments.seatPlanner.noStaffAssigned', 'No staff assigned')}
          </span>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" className="flex-1" disabled={!isOwn} onClick={onOpenStaff}>
            <Users className="size-4" />{t('appointments.seatPlanner.assignStaff', 'Assign staff')}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!isOwn} onClick={onClear}>{t('appointments.seatPlanner.clear', 'Clear')}</Button>
        </div>
      </div>
    </div>
  )
}

function StaffSheet(props: {
  target: StaffSheetTarget
  staff: StaffMember[]
  busyStaffIds: Set<string>
  isSaving: boolean
  onClose: () => void
  onAssign: (staffId: string | null) => void
  onDurationChange: (duration: number) => void
}) {
  const { target, staff, busyStaffIds, isSaving, onClose, onAssign, onDurationChange } = props
  const t = useT()
  const [query, setQuery] = React.useState('')
  const duration = durationMinutes(target.allocation.startsAt, target.allocation.endsAt)
  const filteredStaff = React.useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return staff
    return staff.filter((member) => `${member.displayName} ${member.roleLabel}`.toLowerCase().includes(value))
  }, [query, staff])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/20" onClick={onClose}>
      <aside className="flex h-full w-full max-w-md flex-col bg-surface shadow-lg" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-border p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{t('appointments.seatPlanner.assignStaff', 'Assign staff')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('appointments.seatPlanner.assignStaffHint', 'Choose staff for this selected seat and time window.')}</p>
            </div>
            <IconButton type="button" variant="ghost" aria-label={t('common.close', 'Close')} onClick={onClose}><X className="size-4" /></IconButton>
          </div>
        </div>
        <div className="border-b border-border bg-muted/40 p-5">
          <p className="font-semibold">{target.allocation.serviceName}</p>
          <p className="mt-1 text-sm text-muted-foreground">{[target.allocation.resourceName, `${formatTime(target.allocation.startsAt)} - ${formatTime(target.allocation.endsAt)}`].filter(Boolean).join(', ')}</p>
          <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-3">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">{t('appointments.seatPlanner.duration', 'Duration')}</p>
              <p className="text-sm font-semibold">{duration} min</p>
            </div>
            <div className="flex items-center gap-2">
              <IconButton type="button" size="sm" variant="outline" disabled={duration <= MIN_DURATION || isSaving} onClick={() => onDurationChange(duration - SLOT_MINUTES)}><Minus className="size-4" /></IconButton>
              <IconButton type="button" size="sm" variant="outline" disabled={duration >= MAX_DURATION || isSaving} onClick={() => onDurationChange(duration + SLOT_MINUTES)}><Plus className="size-4" /></IconButton>
            </div>
          </div>
        </div>
        <div className="border-b border-border p-4">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} leftIcon={<Search className="size-4" />} placeholder={t('appointments.seatPlanner.searchStaff', 'Search staff...')} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-2">
            <Button type="button" variant="ghost" className="w-full justify-start" disabled={isSaving} onClick={() => onAssign(null)}>
              <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"><X className="size-4" /></span>
              {t('appointments.seatPlanner.unassignStaff', 'No staff')}
            </Button>
            {filteredStaff.map((member) => {
              const busy = busyStaffIds.has(member.id)
              const active = target.allocation.assignedMemberId === member.id
              return (
                <Button key={member.id} type="button" variant={active ? 'outline' : 'ghost'} className="h-auto w-full justify-start gap-3 p-3" disabled={isSaving || busy} onClick={() => onAssign(member.id)}>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                    {member.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-semibold">{member.displayName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{busy ? t('appointments.seatPlanner.staffBusy', 'Busy') : member.roleLabel}</span>
                  </span>
                  {active ? <Check className="size-4" /> : null}
                </Button>
              )
            })}
          </div>
        </div>
      </aside>
    </div>
  )
}

export default function SeatPlannerPage({ params }: SeatPlannerPageProps) {
  const t = useT()
  const appointmentId = typeof params?.id === 'string' ? params.id : ''
  const slots = React.useMemo(buildSlots, [])
  const timeMarkers = React.useMemo(buildTimeMarkers, [])
  const [workspace, setWorkspace] = React.useState<SeatPlannerWorkspace | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [activeLineId, setActiveLineId] = React.useState<string | null>(null)
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false)
  const [popoverState, setPopoverState] = React.useState<PopoverState | null>(null)
  const [staffSheetTarget, setStaffSheetTarget] = React.useState<StaffSheetTarget | null>(null)
  const timelineRef = React.useRef<HTMLDivElement>(null)
  const guardedMutation = useGuardedMutation({ contextId: appointmentId ? `appointments.seatPlanner:${appointmentId}` : 'appointments.seatPlanner:pending' })

  const loadWorkspace = React.useCallback(async (signal?: AbortSignal) => {
    if (!appointmentId) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await readApiResultOrThrow<SeatPlannerWorkspace>(`/api/appointments/${encodeURIComponent(appointmentId)}/seat-planner`, { signal }, { allowNullResult: true })
      if (!data) {
        setError(t('appointments.detail.notFound', 'Appointment not found.'))
        return
      }
      setWorkspace(data)
      setActiveLineId((current) => current && data.lines.some((line) => line.id === current) ? current : data.lines.find((line) => !line.currentAssignment)?.id ?? data.lines[0]?.id ?? null)
    } catch (loadError) {
      if ((loadError as { name?: string })?.name !== 'AbortError') {
        setError(loadError instanceof Error ? loadError.message : t('appointments.seatPlanner.loadError', 'Failed to load seat planner.'))
      }
    } finally {
      setIsLoading(false)
    }
  }, [appointmentId, t])

  React.useEffect(() => {
    const controller = new AbortController()
    void loadWorkspace(controller.signal)
    return () => controller.abort()
  }, [loadWorkspace])

  const seatColumns = React.useMemo(() => groupResources(workspace?.resources ?? []), [workspace?.resources])
  const ownAllocations = React.useMemo<PlannerAllocation[]>(() => {
    if (!workspace) return []
    return workspace.lines.reduce<PlannerAllocation[]>((allocations, line) => {
      if (!line.currentAssignment) return allocations
      allocations.push({
        id: line.currentAssignment.id,
        appointmentId: workspace.appointment.id,
        lineId: line.id,
        resourceId: line.currentAssignment.resourceId,
        resourceName: line.currentAssignment.resourceName,
        serviceName: line.productTitle,
        customerName: workspace.appointment.customerName,
        startsAt: line.currentAssignment.startsAt,
        endsAt: line.currentAssignment.endsAt,
        state: line.currentAssignment.state,
        assignedMemberId: line.currentAssignment.assignedMemberId,
        assignedMemberName: line.currentAssignment.assignedMemberName,
        laneIndex: 0,
        lanesCount: 1,
      })
      return allocations
    }, [])
  }, [workspace])
  const allAllocations = React.useMemo(() => {
    if (!workspace) return []
    const bySeat = new Map<string, PlannerAllocation[]>()
    const allocations = new Map<string, PlannerAllocation>()
    for (const allocation of workspace.allocations) allocations.set(allocation.id, allocation)
    for (const allocation of ownAllocations) allocations.set(allocation.id, allocation)
    for (const allocation of allocations.values()) bySeat.set(allocation.resourceId, [...(bySeat.get(allocation.resourceId) ?? []), allocation])
    return [...bySeat.values()].flatMap(computeLanes)
  }, [ownAllocations, workspace])
  const allocationsBySeat = React.useMemo(() => {
    const map = new Map<string, PlannerAllocation[]>()
    for (const allocation of allAllocations) map.set(allocation.resourceId, [...(map.get(allocation.resourceId) ?? []), allocation])
    return map
  }, [allAllocations])
  const activeLine = React.useMemo(() => workspace?.lines.find((line) => line.id === activeLineId) ?? null, [activeLineId, workspace?.lines])
  const earliestTime = workspace ? formatTime(workspace.appointment.requestedStartAt) : minutesToTime(START_HOUR * 60)
  const earliestDate = workspace ? new Date(workspace.appointment.requestedStartAt) : null
  const earliestMinutes = earliestDate ? earliestDate.getHours() * 60 + earliestDate.getMinutes() : START_HOUR * 60
  const bodyHeight = ((END_HOUR - START_HOUR) * 60 / SLOT_MINUTES) * slotHeight()
  const gridTemplateColumns = `${TIME_COLUMN_WIDTH}px ${seatColumns.map(() => `${SEAT_COLUMN_WIDTH}px`).join(' ')}`
  const boardWidth = TIME_COLUMN_WIDTH + seatColumns.length * SEAT_COLUMN_WIDTH
  const isSaving = guardedMutation.isPending
  const canConfirm = Boolean(workspace?.lines.length) && Boolean(workspace?.lines.every((line) => Boolean(line.currentAssignment))) && !isSaving

  const saveDraft = React.useCallback(async (line: SeatPlannerLine, resourceId: string, startsAt: string, duration: number, assignedMemberId?: string | null) => {
    if (!workspace) return
    const body = { resourceId, startsAt, endsAt: addMinutes(startsAt, duration), assignedMemberId: assignedMemberId ?? line.currentAssignment?.assignedMemberId ?? null }
    await guardedMutation.runMutation({
      operation: () => readApiResultOrThrow(`/api/appointments/${encodeURIComponent(workspace.appointment.id)}/lines/${encodeURIComponent(line.id)}/draft`, { method: 'PUT', body: JSON.stringify(body) }),
      context: { appointmentId: workspace.appointment.id, lineId: line.id, resourceKind: 'appointments.seatPlannerDraft' },
      mutationPayload: body,
    })
    await loadWorkspace()
  }, [guardedMutation, loadWorkspace, workspace])

  const clearDraft = React.useCallback(async (lineId: string) => {
    if (!workspace) return
    await guardedMutation.runMutation({
      operation: () => readApiResultOrThrow(`/api/appointments/${encodeURIComponent(workspace.appointment.id)}/lines/${encodeURIComponent(lineId)}/draft`, { method: 'DELETE' }),
      context: { appointmentId: workspace.appointment.id, lineId, resourceKind: 'appointments.seatPlannerDraft' },
      mutationPayload: { appointmentId: workspace.appointment.id, lineId },
    })
    setPopoverState(null)
    await loadWorkspace()
    flash(t('appointments.seatPlanner.draftCleared', 'Draft cleared'), 'success')
  }, [guardedMutation, loadWorkspace, t, workspace])

  const handleSlotClick = React.useCallback(async (resourceId: string, time: string) => {
    if (!workspace || !activeLine) return
    const startMinutes = timeToMinutes(time)
    if (startMinutes < earliestMinutes) {
      flash(t('appointments.seatPlanner.beforeEarliestError', 'This booking cannot start before the requested time.'), 'error')
      return
    }
    const overlapping = (allocationsBySeat.get(resourceId) ?? []).some((allocation) => {
      if (allocation.appointmentId === workspace.appointment.id) return false
      const start = new Date(allocation.startsAt)
      const end = new Date(allocation.endsAt)
      return startMinutes >= start.getHours() * 60 + start.getMinutes() && startMinutes < end.getHours() * 60 + end.getMinutes()
    })
    if (overlapping) {
      flash(t('appointments.seatPlanner.resourceBooked', 'That resource is already booked for this time.'), 'error')
      return
    }
    const activeIndex = workspace.lines.findIndex((line) => line.id === activeLine.id)
    let nextStart = buildIsoFromSlot(workspace.appointment.requestedStartAt, time)
    for (const line of workspace.lines.slice(Math.max(0, activeIndex))) {
      if (line.id !== activeLine.id && line.currentAssignment) break
      await saveDraft(line, resourceId, nextStart, lineDuration(line))
      nextStart = addMinutes(nextStart, lineDuration(line))
    }
    flash(t('appointments.seatPlanner.saved', 'Assignment saved'), 'success')
  }, [activeLine, allocationsBySeat, earliestMinutes, saveDraft, t, workspace])

  const handleConfirmAll = React.useCallback(async () => {
    if (!workspace) return
    await guardedMutation.runMutation({
      operation: () => readApiResultOrThrow(`/api/appointments/${encodeURIComponent(workspace.appointment.id)}/confirm-drafts`, { method: 'POST' }),
      context: { appointmentId: workspace.appointment.id, resourceKind: 'appointments.seatPlanner' },
      mutationPayload: { appointmentId: workspace.appointment.id },
    })
    await loadWorkspace()
    flash(t('appointments.seatPlanner.confirmed', 'All assignments confirmed'), 'success')
  }, [guardedMutation, loadWorkspace, t, workspace])

  const handleDurationChange = React.useCallback(async (allocation: PlannerAllocation, nextDuration: number) => {
    const line = workspace?.lines.find((entry) => entry.id === allocation.lineId)
    if (!line || allocation.appointmentId !== workspace?.appointment.id) return
    await saveDraft(line, allocation.resourceId, allocation.startsAt, nextDuration, allocation.assignedMemberId ?? null)
    setPopoverState(null)
  }, [saveDraft, workspace])

  const handleAssignStaff = React.useCallback(async (target: StaffSheetTarget, staffId: string | null) => {
    const line = target.line
    if (!line || target.allocation.appointmentId !== workspace?.appointment.id) return
    await saveDraft(line, target.allocation.resourceId, target.allocation.startsAt, durationMinutes(target.allocation.startsAt, target.allocation.endsAt), staffId)
    setStaffSheetTarget(null)
    setPopoverState(null)
    flash(staffId ? t('appointments.seatPlanner.staffAssigned', 'Staff assigned') : t('appointments.seatPlanner.staffUnassigned', 'Staff removed'), 'success')
  }, [saveDraft, t, workspace?.appointment.id])

  const busyStaffIds = React.useMemo(() => {
    if (!staffSheetTarget) return new Set<string>()
    const busy = new Set<string>()
    const targetStart = new Date(staffSheetTarget.allocation.startsAt).getTime()
    const targetEnd = new Date(staffSheetTarget.allocation.endsAt).getTime()
    for (const allocation of allAllocations) {
      if (allocation.id === staffSheetTarget.allocation.id || !allocation.assignedMemberId) continue
      const start = new Date(allocation.startsAt).getTime()
      const end = new Date(allocation.endsAt).getTime()
      if (targetStart < end && start < targetEnd) busy.add(allocation.assignedMemberId)
    }
    return busy
  }, [allAllocations, staffSheetTarget])

  React.useEffect(() => {
    if (!timelineRef.current || ownAllocations.length === 0) return
    const first = [...ownAllocations].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0]
    if (!first) return
    const seatIndex = seatColumns.findIndex((seat) => seat.id === first.resourceId)
    timelineRef.current.scrollTo({ top: Math.max(0, allocationTop(first) - 80), left: Math.max(0, TIME_COLUMN_WIDTH + Math.max(0, seatIndex) * SEAT_COLUMN_WIDTH - 120), behavior: 'smooth' })
  }, [ownAllocations, seatColumns])

  if (isLoading) {
    return (
      <Page><PageBody><div className="flex h-64 items-center justify-center"><LoadingMessage label={t('common.loading', 'Loading...')} /></div></PageBody></Page>
    )
  }

  if (error || !workspace) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-64 flex-col items-center justify-center gap-4">
            <ErrorMessage label={error ?? t('appointments.seatPlanner.loadError', 'Failed to load seat planner.')} />
            <Button type="button" variant="outline" onClick={() => void loadWorkspace()}>{t('common.retry', 'Retry')}</Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody className="p-0">
        <div className="flex min-h-0 flex-col overflow-hidden bg-surface" style={{ height: 'calc(100vh - 4rem)' }}>
          <header className="shrink-0 border-b border-border bg-surface">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <IconButton asChild variant="ghost" aria-label={t('common.back', 'Back')}>
                  <Link href={`/backend/appointments/${workspace.appointment.id}`}><ArrowLeft className="size-4" /></Link>
                </IconButton>
                <IconButton type="button" variant="outline" className="lg:hidden" aria-label={t('appointments.seatPlanner.openSidebar', 'Open booking details')} onClick={() => setMobileSidebarOpen(true)}>
                  <Menu className="size-4" />
                </IconButton>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-base font-semibold">{t('appointments.seatPlanner.title', 'Seat Planner')}</h1>
                    {activeLine ? <Tag variant="info">{activeLine.productTitle}</Tag> : null}
                  </div>
                  <div className="hidden md:block"><LegendBar earliestTime={earliestTime} /></div>
                </div>
              </div>
              <Button type="button" disabled={!canConfirm} onClick={() => void handleConfirmAll()}>
                <Check className="size-4" />
                <span className="hidden sm:inline">{t('appointments.seatPlanner.confirmSchedule', 'Confirm schedule')}</span>
              </Button>
            </div>
            <div className="border-t border-border px-4 py-2 md:hidden"><LegendBar earliestTime={earliestTime} /></div>
          </header>

          <div className="flex min-h-0 flex-1">
            {mobileSidebarOpen ? <div className="fixed inset-0 z-40 bg-foreground/20 lg:hidden" onClick={() => setMobileSidebarOpen(false)} /> : null}
            <aside className={`fixed inset-y-0 left-0 z-50 w-full max-w-sm border-r border-border bg-surface shadow-lg transition-transform lg:static lg:z-auto lg:w-80 lg:translate-x-0 lg:shadow-none ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
              <div className="flex h-12 items-center justify-between border-b border-border px-3 lg:hidden">
                <p className="text-sm font-semibold">{t('appointments.seatPlanner.bookingDetails', 'Booking details')}</p>
                <IconButton type="button" variant="ghost" aria-label={t('common.close', 'Close')} onClick={() => setMobileSidebarOpen(false)}><PanelLeftClose className="size-4" /></IconButton>
              </div>
              <div className="lg:h-full" style={{ height: 'calc(100% - 3rem)' }}>
                <BookingSidebar
                  workspace={workspace}
                  activeLineId={activeLineId}
                  canManage
                  isSaving={isSaving}
                  onSelectLine={(lineId) => {
                    setActiveLineId(lineId)
                    setMobileSidebarOpen(false)
                  }}
                  onClearLine={(lineId) => void clearDraft(lineId)}
                  onPreviewAction={() => flash(t('appointments.seatPlanner.frontendPreview', 'This action is wired as a frontend preview for now.'), 'info')}
                />
              </div>
            </aside>

            <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Clock className="size-4 text-muted-foreground" />
                  <span className="text-xs font-semibold uppercase tracking-wider">{t('appointments.seatPlanner.seatsStations', 'Seats and stations')}</span>
                  <Tag variant="neutral">{seatColumns.length} {t('appointments.seatPlanner.seats', 'seats')}</Tag>
                </div>
                {isSaving ? <Tag variant="warning">{t('appointments.seatPlanner.saving', 'Saving')}</Tag> : null}
              </div>

              <div ref={timelineRef} className="min-h-0 flex-1 overflow-auto bg-muted/20">
                {seatColumns.length === 0 ? (
                  <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">{t('appointments.seatPlanner.noSeats', 'No resources are available for this organization.')}</div>
                ) : (
                  <div style={{ minWidth: boardWidth }}>
                    <div className="relative" style={{ height: bodyHeight + HEADER_HEIGHT }}>
                      <div className="sticky top-0 z-30 grid border-b border-border bg-surface shadow-sm" style={{ gridTemplateColumns }}>
                        <div className="sticky left-0 z-40 flex items-center justify-center border-r border-border bg-surface px-3 text-xs font-semibold uppercase tracking-wider" style={{ height: HEADER_HEIGHT }}>
                          {t('appointments.seatPlanner.time', 'Time')}
                        </div>
                        {seatColumns.map((seat) => (
                          <div key={seat.id} className={`flex flex-col justify-center gap-2 overflow-hidden border-r border-border bg-surface px-3 py-2 ${seat.isFirstInFloor ? 'border-l' : ''}`} style={{ height: HEADER_HEIGHT }}>
                            <span className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">{seat.floorName}</span>
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted" style={{ color: seat.typeColor ?? seat.capacityUnitColor ?? undefined }}>
                                <ResourceIcon resource={seat} />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{seat.code || seat.name}</p>
                                <p className="truncate text-xs text-muted-foreground">{seat.name}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="absolute inset-x-0 bottom-0 grid" style={{ top: HEADER_HEIGHT, gridTemplateColumns }}>
                        <div className="sticky left-0 z-20 border-r border-border bg-surface">
                          {timeMarkers.map((time) => (
                            <div key={time} className="absolute left-0 right-0 border-t border-dashed border-border" style={{ top: slotTop(time) }}>
                              <span className="absolute left-3 top-1 text-xs text-muted-foreground">{time}</span>
                            </div>
                          ))}
                          <div className="pointer-events-none absolute left-0 right-0 z-30 border-t-2 border-status-warning-border" style={{ top: Math.max(0, ((earliestMinutes - START_HOUR * 60) / SLOT_MINUTES) * slotHeight()) }} />
                        </div>

                        {seatColumns.map((seat) => (
                          <div key={seat.id} className={`relative border-r border-border bg-surface ${seat.isFirstInFloor ? 'border-l' : ''}`}>
                            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-muted/60" style={{ height: Math.max(0, ((earliestMinutes - START_HOUR * 60) / SLOT_MINUTES) * slotHeight()) }} />
                            {timeMarkers.map((time) => <div key={`${seat.id}-${time}`} className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-border" style={{ top: slotTop(time) }} />)}
                            {slots.map((time) => {
                              const minutes = timeToMinutes(time)
                              const beforeEarliest = minutes < earliestMinutes
                              const blocked = beforeEarliest || (allocationsBySeat.get(seat.id) ?? []).some((allocation) => {
                                if (allocation.appointmentId === workspace.appointment.id) return false
                                const start = new Date(allocation.startsAt)
                                const end = new Date(allocation.endsAt)
                                return minutes >= start.getHours() * 60 + start.getMinutes() && minutes < end.getHours() * 60 + end.getMinutes()
                              })
                              return (
                                <Button
                                  key={`${seat.id}-${time}-slot`}
                                  type="button"
                                  variant="ghost"
                                  className={`absolute left-0 right-0 rounded-none border-t border-transparent p-0 ${blocked ? 'cursor-not-allowed opacity-40' : 'hover:bg-primary/10'}`}
                                  style={{ top: slotTop(time), height: slotHeight() }}
                                  disabled={!activeLine || isSaving}
                                  onClick={() => {
                                    if (blocked) {
                                      flash(beforeEarliest ? t('appointments.seatPlanner.beforeEarliestError', 'This booking cannot start before the requested time.') : t('appointments.seatPlanner.resourceBooked', 'That resource is already booked for this time.'), 'error')
                                      return
                                    }
                                    void handleSlotClick(seat.id, time)
                                  }}
                                  aria-label={`${seat.name} ${time}`}
                                />
                              )
                            })}
                            {(allocationsBySeat.get(seat.id) ?? []).map((allocation) => {
                              const line = workspace.lines.find((entry) => entry.id === allocation.lineId) ?? null
                              return (
                                <PlannerBlock
                                  key={allocation.id}
                                  allocation={{ ...allocation, resourceName: seat.name }}
                                  line={line}
                                  isOwn={allocation.appointmentId === workspace.appointment.id}
                                  isActive={allocation.lineId === activeLineId}
                                  onResizeEnd={(nextDuration) => handleDurationChange(allocation, nextDuration)}
                                  onOpen={(event) => {
                                    setPopoverState({ allocation: { ...allocation, resourceName: seat.name }, anchor: event.currentTarget.getBoundingClientRect() })
                                    if (allocation.appointmentId === workspace.appointment.id) setActiveLineId(allocation.lineId)
                                  }}
                                />
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </main>
          </div>
        </div>

        {popoverState ? (
          <DraftPopover
            state={popoverState}
            line={workspace.lines.find((line) => line.id === popoverState.allocation.lineId) ?? null}
            isOwn={popoverState.allocation.appointmentId === workspace.appointment.id}
            onClose={() => setPopoverState(null)}
            onClear={() => void clearDraft(popoverState.allocation.lineId)}
            onDurationChange={(nextDuration) => void handleDurationChange(popoverState.allocation, nextDuration)}
            onOpenStaff={() => setStaffSheetTarget({ allocation: popoverState.allocation, line: workspace.lines.find((line) => line.id === popoverState.allocation.lineId) ?? null })}
          />
        ) : null}

        {staffSheetTarget ? (
          <StaffSheet
            target={staffSheetTarget}
            staff={mockStaff}
            busyStaffIds={busyStaffIds}
            isSaving={isSaving}
            onClose={() => setStaffSheetTarget(null)}
            onAssign={(staffId) => void handleAssignStaff(staffSheetTarget, staffId)}
            onDurationChange={(nextDuration) => void handleDurationChange(staffSheetTarget.allocation, nextDuration)}
          />
        ) : null}
      </PageBody>
    </Page>
  )
}
