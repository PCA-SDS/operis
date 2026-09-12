"use client"

import * as React from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  Menu,
  MapPin,
  Mail,
  Minus,
  PanelLeftClose,
  Phone,
  Plus,
  Search,
  Timer,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
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
const OVERLAPPED_LANE_MIN_WIDTH = 128
const MIN_DURATION = 15
const MAX_DURATION = 480
const STAFF_PAGE_SIZE = 50

type SeatPlannerLine = {
  id: string
  productTitle: string
  durationMinutes: number | null
  options: Array<{ groupName: string | null; name: string }>
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
    customerSalutation: string | null
    customerPhone: string | null
    customerEmail: string | null
    customerOrigin: string | null
    bookingType: string | null
    organizationName: string | null
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

type DraftAssignmentResult = {
  id: string
  resourceId: string
  resourceName?: string | null
  state: 'draft' | 'confirmed'
  startsAt: string
  endsAt: string
  assignedMemberId?: string | null
  assignedMemberName?: string | null
}

type StaffMember = { id: string; displayName: string; roleLabel: string }
type PopoverState = { allocation: PlannerAllocation; anchor: DOMRect }
type StaffSheetTarget = { allocation: PlannerAllocation; line: SeatPlannerLine | null }

interface SeatPlannerPageProps {
  params?: { id?: string }
}

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
  const groups: PlannerAllocation[][] = []
  let currentGroup: PlannerAllocation[] = []
  let currentGroupEnd = 0

  for (const allocation of sorted) {
    const start = new Date(allocation.startsAt).getTime()
    const end = new Date(allocation.endsAt).getTime()
    if (currentGroup.length > 0 && start >= currentGroupEnd) {
      groups.push(currentGroup)
      currentGroup = []
      currentGroupEnd = 0
    }
    currentGroup.push(allocation)
    currentGroupEnd = Math.max(currentGroupEnd, end)
  }
  if (currentGroup.length > 0) groups.push(currentGroup)

  return groups.flatMap((group) => {
    const laneEnds: number[] = []
    const result = group.map((allocation) => {
      const start = new Date(allocation.startsAt).getTime()
      const end = new Date(allocation.endsAt).getTime()
      const openLane = laneEnds.findIndex((laneEnd) => laneEnd <= start)
      const laneIndex = openLane >= 0 ? openLane : laneEnds.length
      laneEnds[laneIndex] = end
      return { ...allocation, laneIndex, lanesCount: 1 }
    })
    const lanesCount = Math.max(1, laneEnds.length)
    return result.map((allocation) => ({ ...allocation, lanesCount }))
  })
}

function blockTone(isOwn: boolean, isActive: boolean, state: 'draft' | 'confirmed'): string {
  if (!isOwn) return 'border-border bg-muted text-muted-foreground'
  if (isActive) return 'border-primary bg-primary text-primary-foreground shadow-md'
  if (state === 'confirmed') return 'border-status-success-border bg-status-success-bg text-status-success-text'
  return 'border-status-info-border bg-status-info-bg text-status-info-text'
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
  const laneInset = 8 / allocation.lanesCount

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
      data-seat-planner-allocation-id={allocation.id}
      className={`absolute flex cursor-pointer flex-col overflow-hidden rounded-md border px-2 py-1 text-xs transition hover:ring-2 hover:ring-primary/40 ${blockTone(isOwn, isActive, allocation.state)}`}
      style={{
        zIndex: dragDuration !== null ? 25 : (isActive ? 21 : 20),
        top: allocationTop(allocation),
        height: Math.max((displayDuration / SLOT_MINUTES) * slotHeight(), 24),
        left: `calc(4px + ${allocation.laneIndex * laneWidth}% - ${allocation.laneIndex * laneInset}px)`,
        width: `calc(${laneWidth}% - ${laneInset}px)`,
      }}
      onClick={(event) => {
        event.stopPropagation()
        onOpen(event)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onOpen(event as unknown as React.MouseEvent<HTMLDivElement>)
      }}
    >
      <span className={`${displayDuration <= 15 ? 'truncate' : 'line-clamp-2'} font-semibold leading-tight`}>{allocation.serviceName}</span>
      {displayDuration > 30 ? (
        <span className="truncate text-[10px] opacity-80">{allocation.assignedMemberName || line?.currentAssignment?.assignedMemberName || 'No staff assigned'}</span>
      ) : null}
      {displayDuration >= 30 ? (
        <span className="mt-auto truncate text-[10px] opacity-80">{formatTime(allocation.startsAt)} - {formatTime(addMinutes(allocation.startsAt, displayDuration))}</span>
      ) : null}
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
  const customerInitials = workspace.appointment.customerName
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const displayName = [workspace.appointment.customerSalutation, workspace.appointment.customerName].filter(Boolean).join(' ')
  const formatLabel = (value: string | null) => value
    ? value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase())
    : null
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface">
      <div className="shrink-0 border-b border-border p-3 lg:p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background">
            {customerInitials || '?'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-base font-semibold">{displayName}</p>
              <AppointmentStatusBadge statusCode={workspace.appointment.statusCode} />
            </div>
            {workspace.appointment.customerPhone ? (
              <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground"><Phone className="size-3.5 shrink-0" />{workspace.appointment.customerPhone}</p>
            ) : null}
            {workspace.appointment.customerEmail ? <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground"><Mail className="size-3.5 shrink-0" />{workspace.appointment.customerEmail}</p> : null}
          </div>
        </div>
        {workspace.appointment.customerOrigin || workspace.appointment.bookingType ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[workspace.appointment.customerOrigin, workspace.appointment.bookingType].filter(Boolean).map((value) => <Tag key={value} variant="neutral">{formatLabel(value)}</Tag>)}
          </div>
        ) : null}
        <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
          <div className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2"><MapPin className="size-3.5 shrink-0" /><span className="truncate font-medium text-foreground">{workspace.appointment.organizationName ?? t('appointments.seatPlanner.locationUnavailable', 'Location unavailable')}</span></div>
            <div className="flex items-center gap-2"><Calendar className="size-3.5 shrink-0" /><span className="truncate">{formatDate(workspace.appointment.requestedStartAt)}</span></div>
            <div className="flex items-center gap-2"><Clock className="size-3.5 shrink-0" /><span className="truncate">{formatTime(workspace.appointment.requestedStartAt)} - {formatTime(workspace.appointment.requestedEndAt ?? addMinutes(workspace.appointment.requestedStartAt, 60))}</span></div>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button type="button" size="sm" variant="outline" className="flex-1" onClick={onPreviewAction}>{t('appointments.seatPlanner.edit', 'Edit')}</Button>
          <Button type="button" size="sm" variant="outline" className="flex-1" onClick={onPreviewAction}>{t('appointments.seatPlanner.payment', 'Payment')}</Button>
        </div>
      </div>

      <div className="flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{t('appointments.seatPlanner.serviceQueue', 'Services to schedule')}</p>
            <p className="text-xs text-muted-foreground">{assigned}/{workspace.lines.length} {t('appointments.seatPlanner.readyToConfirm', 'ready to confirm')}</p>
          </div>
          <IconButton type="button" size="sm" variant="outline" aria-label={t('appointments.seatPlanner.addService', 'Add service')} onClick={onPreviewAction}>
            <Plus className="size-4" />
          </IconButton>
        </div>

        <div className="p-3 pb-8">
          <div className="space-y-2">
            {workspace.lines.map((line, index) => {
              const active = line.id === activeLineId
              return (
                <div
                  key={line.id}
                  role="button"
                  tabIndex={0}
                  data-seat-planner-line-id={line.id}
                  className={`rounded-md border p-3 transition ${active ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-surface hover:bg-muted/40'}`}
                  onClick={() => onSelectLine(line.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') onSelectLine(line.id)
                  }}
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground shadow-sm">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="line-clamp-2 text-sm font-medium">{line.productTitle}</p>
                          {line.currentAssignment ? <Check className="mt-0.5 size-4 shrink-0 text-status-success-icon" /> : null}
                        </div>
                        {line.options.length > 0 ? (
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            {line.options.map((option, i) => (
                              <span key={`${option.groupName ?? 'option'}-${option.name}`} className="flex items-center">
                                {i > 0 && <span className="mr-2 opacity-40">•</span>}
                                {option.groupName ? <span className="mr-1 opacity-70">{option.groupName}:</span> : null}
                                <span className="font-medium text-foreground">{option.name}</span>
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <Tag variant="neutral" className="mt-2 h-5 px-1.5 text-[11px] leading-none">
                          <Clock className="mr-1 inline-block size-3 opacity-70" />
                          {lineDuration(line)} {t('appointments.seatPlanner.minutesShort', 'min')}
                        </Tag>
                      </div>
                    </div>
                    {line.currentAssignment ? (
                      <div className="ml-9 flex items-start justify-between gap-2 rounded-md border border-border/50 bg-muted/20 p-2.5 text-xs shadow-sm">
                        <div className="min-w-0 space-y-1.5 text-muted-foreground">
                          <div className="flex items-center gap-2 truncate">
                            <Clock className="size-3.5 shrink-0" />
                            <span className="font-medium text-foreground">{formatTime(line.currentAssignment.startsAt)} - {formatTime(line.currentAssignment.endsAt)}</span>
                          </div>
                          <div className="flex items-center gap-2 truncate">
                            <MapPin className="size-3.5 shrink-0" />
                            <span>{t('appointments.seatPlanner.seat', 'Seat')}: <span className="font-medium text-foreground">{line.currentAssignment.resourceName ?? t('appointments.seatPlanner.notSelected', 'Not selected')}</span></span>
                          </div>
                          <div className="flex items-center gap-2 truncate">
                            <UserRound className="size-3.5 shrink-0" />
                            <span>{t('appointments.seatPlanner.staff', 'Staff')}: <span className="font-medium text-foreground">{line.currentAssignment.assignedMemberName ?? t('appointments.seatPlanner.notSelected', 'Not selected')}</span></span>
                          </div>
                        </div>
                        {canManage && line.currentAssignment.state === 'draft' ? (
                          <IconButton
                            type="button"
                            size="xs"
                            variant="ghost"
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
  const popoverRef = React.useRef<HTMLDivElement>(null)
  const [position, setPosition] = React.useState({ left: 12, top: 12 })

  React.useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  React.useLayoutEffect(() => {
    const updatePosition = () => {
      const element = popoverRef.current
      if (!element) return
      const margin = 12
      const preferredLeft = state.anchor.right + margin
      const left = preferredLeft + element.offsetWidth <= window.innerWidth - margin
        ? preferredLeft
        : state.anchor.left - element.offsetWidth - margin
      const top = Math.min(
        Math.max(margin, state.anchor.top),
        Math.max(margin, window.innerHeight - element.offsetHeight - margin),
      )
      setPosition({ left: Math.max(margin, left), top })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [currentDuration, isOwn, line, state.anchor])

  const commitDuration = () => {
    const next = Number(rawDuration)
    if (Number.isFinite(next) && next > 0 && next !== currentDuration) onDurationChange(snapDuration(next))
    else setRawDuration(String(currentDuration))
  }

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={allocation.serviceName}
      className="fixed z-50 flex max-h-[calc(100vh-1.5rem)] w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
      style={{ left: position.left, top: position.top }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{allocation.serviceName}</h3>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            <span className="truncate font-medium text-foreground">{allocation.resourceName ?? line?.currentAssignment?.resourceName}</span>
          </div>
        </div>
        <IconButton type="button" size="sm" variant="ghost" className="shrink-0 -mr-1 -mt-1 text-muted-foreground" aria-label={t('common.close', 'Close')} onClick={onClose}><X className="size-4" /></IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        <div className="space-y-4">
          {/* Time & Duration */}
          <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <Clock className="size-3.5" />
              {t('appointments.seatPlanner.time', 'Time')}
            </div>
            <p className="mt-1 text-sm font-semibold">{formatTime(allocation.startsAt)} - {formatTime(allocation.endsAt)}</p>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <Timer className="size-3.5" />
                {t('appointments.seatPlanner.duration', 'Duration')}
              </div>
            <div className="mt-1">
              {isOwn ? (
                <Input
                  type="number"
                  size="sm"
                  className="h-8"
                  value={rawDuration}
                  onChange={(event) => setRawDuration(event.target.value)}
                  onBlur={commitDuration}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitDuration()
                  }}
                  rightIcon={<span className="pr-1 text-xs text-muted-foreground">min</span>}
                />
              ) : (
                <p className="text-sm font-semibold">{currentDuration} min</p>
              )}
            </div>
          </div>
          </div>

          {/* Staff */}
          <div className="flex items-center gap-2.5 rounded-md border border-border/50 bg-muted/20 p-2.5">
            <UserRound className={`size-4 shrink-0 ${allocation.assignedMemberName ? 'text-muted-foreground' : 'text-status-warning-text'}`} />
            <span className={`truncate text-sm font-medium ${allocation.assignedMemberName ? 'text-foreground' : 'text-status-warning-text'}`}>
              {allocation.assignedMemberName || t('appointments.seatPlanner.noStaffAssigned', 'No staff assigned')}
            </span>
          </div>

          {/* Options */}
          {line && line.options.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('appointments.seatPlanner.options', 'Options')}</p>
              <div className="flex flex-col gap-1 text-xs text-foreground">
                {line.options.map((option, i) => (
                  <span key={`${option.groupName ?? 'option'}-${option.name}`} className="flex items-center">
                    {i > 0 && <ChevronRight className="mx-1 size-3 shrink-0 opacity-40" />}
                    {option.groupName ? <span className="mr-1 shrink-0 opacity-70">{option.groupName}:</span> : null}
                    <span className="font-medium">{option.name}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>

      </div>
      {isOwn ? (
        <div className="flex shrink-0 gap-2 border-t border-border bg-surface p-3">
          <Button type="button" size="sm" className="flex-1" onClick={onOpenStaff}>
            <Users className="size-4" />
            {t('appointments.seatPlanner.assignStaff', 'Assign staff')}
          </Button>
          <Button type="button" size="sm" variant="outline" className="text-muted-foreground hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive" onClick={onClear}>
            {t('appointments.seatPlanner.clear', 'Clear')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function StaffSheet(props: {
  target: StaffSheetTarget
  staff: StaffMember[]
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
  const { target, staff, isLoadingStaff, isLoadingMoreStaff, hasMoreStaff, busyStaffIds, isSaving, onClose, onAssign, onDurationChange, onLoadMore } = props
  const t = useT()
  const [query, setQuery] = React.useState('')
  const resultsRef = React.useRef<HTMLDivElement>(null)
  const duration = durationMinutes(target.allocation.startsAt, target.allocation.endsAt)
  const filteredStaff = React.useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return staff
    return staff.filter((member) => `${member.displayName} ${member.roleLabel}`.toLowerCase().includes(value))
  }, [query, staff])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/20" onClick={onClose}>
      <aside className="flex h-full w-full max-w-md flex-col bg-surface shadow-lg" onClick={(event) => event.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{t('appointments.seatPlanner.assignStaff', 'Assign staff')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('appointments.seatPlanner.assignStaffHint', 'Choose staff for this selected seat and time window.')}</p>
          </div>
          <IconButton type="button" variant="ghost" aria-label={t('common.close', 'Close')} onClick={onClose}><X className="size-4" /></IconButton>
        </div>

        <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-3">
          <p className="text-sm font-semibold">{target.allocation.serviceName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><MapPin className="size-3.5" />{target.allocation.resourceName}</span>
            <span aria-hidden="true">•</span>
            <span className="flex items-center gap-1"><Clock className="size-3.5" />{formatTime(target.allocation.startsAt)} - {formatTime(target.allocation.endsAt)}</span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2.5">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('appointments.seatPlanner.duration', 'Duration')}</p>
              <p className="mt-0.5 text-sm font-semibold">{duration} min</p>
            </div>
            <div className="flex items-center gap-2">
              <IconButton type="button" size="sm" variant="outline" aria-label={t('appointments.seatPlanner.decreaseDuration', 'Decrease duration')} disabled={duration <= MIN_DURATION || isSaving} onClick={() => onDurationChange(duration - SLOT_MINUTES)}><Minus className="size-4" /></IconButton>
              <IconButton type="button" size="sm" variant="outline" aria-label={t('appointments.seatPlanner.increaseDuration', 'Increase duration')} disabled={duration >= MAX_DURATION || isSaving} onClick={() => onDurationChange(duration + SLOT_MINUTES)}><Plus className="size-4" /></IconButton>
            </div>
          </div>
        </div>

        <div className="shrink-0 border-b border-border p-3">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} leftIcon={<Search className="size-4" />} placeholder={t('appointments.seatPlanner.searchStaff', 'Search staff...')} />
        </div>
        <div
          ref={resultsRef}
          className="min-h-0 flex-1 overflow-y-auto p-3"
          onScroll={(event) => {
            const element = event.currentTarget
            if (element.scrollHeight - element.scrollTop - element.clientHeight < 96 && hasMoreStaff && !isLoadingMoreStaff) onLoadMore()
          }}
        >
          <div className="space-y-2">
            <Button type="button" variant={target.allocation.assignedMemberId ? 'ghost' : 'outline'} className="h-auto w-full justify-start gap-3 p-3" disabled={isSaving || !target.allocation.assignedMemberId} onClick={() => onAssign(null)}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><UserRound className="size-4" /></span>
              <span className="flex-1 text-left text-sm font-semibold">{t('appointments.seatPlanner.noStaffAssigned', 'No staff assigned')}</span>
              {!target.allocation.assignedMemberId ? <Check className="size-4" /> : null}
            </Button>
            {isLoadingStaff ? <p className="p-3 text-sm text-muted-foreground">{t('appointments.seatPlanner.loadingStaff', 'Loading staff...')}</p> : null}
            {!isLoadingStaff && filteredStaff.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
                <span className="flex size-10 items-center justify-center rounded-full bg-muted"><Users className="size-5" /></span>
                <p className="text-sm">{t('appointments.seatPlanner.noStaff', 'No assignable staff found.')}</p>
              </div>
            ) : null}
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
            {isLoadingMoreStaff ? <p className="px-3 py-2 text-center text-xs text-muted-foreground">{t('appointments.seatPlanner.loadingMoreStaff', 'Loading more staff...')}</p> : null}
          </div>
        </div>
      </aside>
    </div>
  )
}

function SeatPlannerLoadingSkeleton() {
  return (
    <Page fill className="!gap-0 !space-y-0">
      <PageBody fill className="!space-y-0 overflow-hidden p-0">
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface" aria-busy="true">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-3">
              <Skeleton shape="circle" className="size-8" />
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-6 w-32 rounded-full" />
            </div>
            <Skeleton className="h-9 w-36 rounded-md" />
          </div>
          <div className="flex min-h-0 flex-1">
            <aside className="hidden w-80 shrink-0 border-r border-border p-4 lg:block">
              <div className="flex items-center gap-3 border-b border-border pb-4">
                <Skeleton shape="circle" className="size-10" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-44" />
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-3 w-48" />
              </div>
              <div className="mt-4 space-y-3">
                {[0, 1, 2].map((item) => (
                  <Skeleton key={item} className="h-24 w-full rounded-md" />
                ))}
              </div>
            </aside>
            <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
                <Skeleton shape="circle" className="size-4" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden p-3">
                <div className="grid h-20 grid-cols-5 gap-px border border-border bg-border">
                  {[0, 1, 2, 3, 4].map((item) => (
                    <div key={item} className="flex flex-col gap-2 bg-surface p-3">
                      <Skeleton className="h-3 w-20" />
                      <div className="flex items-center gap-2">
                        <Skeleton shape="circle" className="size-8" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid h-full grid-cols-5 gap-px border border-border bg-border">
                  {[0, 1, 2, 3, 4].map((item) => (
                    <div key={item} className="space-y-8 bg-surface p-3">
                      {[0, 1, 2, 3, 4, 5].map((row) => <Skeleton key={row} className="h-px w-full" />)}
                    </div>
                  ))}
                </div>
              </div>
            </main>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}

export default function SeatPlannerPage({ params }: SeatPlannerPageProps) {
  const t = useT()
  const appointmentId = typeof params?.id === 'string' ? params.id : ''
  const slots = React.useMemo(buildSlots, [])
  const timeMarkers = React.useMemo(buildTimeMarkers, [])
  const slotGridMarkers = React.useMemo(
    () => slots.filter((time) => timeToMinutes(time) % 60 !== 0),
    [slots],
  )
  const [workspace, setWorkspace] = React.useState<SeatPlannerWorkspace | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [activeLineId, setActiveLineId] = React.useState<string | null>(null)
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false)
  const [popoverState, setPopoverState] = React.useState<PopoverState | null>(null)
  const [staffSheetTarget, setStaffSheetTarget] = React.useState<StaffSheetTarget | null>(null)
  const [staffMembers, setStaffMembers] = React.useState<StaffMember[]>([])
  const [isLoadingStaff, setIsLoadingStaff] = React.useState(false)
  const [isLoadingMoreStaff, setIsLoadingMoreStaff] = React.useState(false)
  const [hasMoreStaff, setHasMoreStaff] = React.useState(true)
  const timelineRef = React.useRef<HTMLDivElement>(null)
  const workspaceRequestRef = React.useRef(0)
  const staffPageRef = React.useRef(0)
  const staffLoadingRef = React.useRef(false)
  const hasMoreStaffRef = React.useRef(true)
  const guardedMutation = useGuardedMutation({ contextId: appointmentId ? `appointments.seatPlanner:${appointmentId}` : 'appointments.seatPlanner:pending' })
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const loadStaffPage = React.useCallback(async (page: number) => {
    if (staffLoadingRef.current || (page > 1 && !hasMoreStaffRef.current)) return
    staffLoadingRef.current = true
    if (page === 1) setIsLoadingStaff(true)
    else setIsLoadingMoreStaff(true)
    try {
      const response = await readApiResultOrThrow<{ items?: Array<{ id: string; displayName: string; teamName?: string | null }> }>(`/api/staff/team-members/assignable?page=${page}&pageSize=${STAFF_PAGE_SIZE}`)
      const items = response.items ?? []
      const nextStaff = items.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        roleLabel: member.teamName ?? t('appointments.seatPlanner.staffMember', 'Staff member'),
      }))
      setStaffMembers((current) => {
        if (page === 1) return nextStaff
        const existingIds = new Set(current.map((member) => member.id))
        return [...current, ...nextStaff.filter((member) => !existingIds.has(member.id))]
      })
      staffPageRef.current = page
      const nextHasMore = items.length >= STAFF_PAGE_SIZE
      hasMoreStaffRef.current = nextHasMore
      setHasMoreStaff(nextHasMore)
    } catch {
      if (page === 1) {
        try {
          const response = await readApiResultOrThrow<{ member?: { id: string; displayName: string } | null }>('/api/staff/team-members/self')
          const fallbackStaff = response.member ? [{ id: response.member.id, displayName: response.member.displayName, roleLabel: t('appointments.seatPlanner.staffMember', 'Staff member') }] : []
          setStaffMembers(fallbackStaff)
          staffPageRef.current = 1
          hasMoreStaffRef.current = false
          setHasMoreStaff(false)
        } catch {
          flash(t('appointments.seatPlanner.staffLoadError', 'Unable to load staff.'), 'error')
        }
      } else {
        flash(t('appointments.seatPlanner.staffLoadMoreError', 'Unable to load more staff.'), 'error')
      }
    } finally {
      staffLoadingRef.current = false
      if (page === 1) setIsLoadingStaff(false)
      else setIsLoadingMoreStaff(false)
    }
  }, [t])

  React.useEffect(() => {
    if (!staffSheetTarget || staffPageRef.current > 0) return
    void loadStaffPage(1)
  }, [loadStaffPage, staffSheetTarget])

  const loadWorkspace = React.useCallback(async (signal?: AbortSignal) => {
    if (!appointmentId) return
    const requestId = workspaceRequestRef.current + 1
    workspaceRequestRef.current = requestId
    setIsLoading(true)
    setError(null)
    try {
      const data = await readApiResultOrThrow<SeatPlannerWorkspace>(`/api/appointments/${encodeURIComponent(appointmentId)}/seat-planner`, { signal }, { allowNullResult: true })
      if (requestId !== workspaceRequestRef.current) return
      if (!data) {
        setError(t('appointments.detail.notFound', 'Appointment not found.'))
        return
      }
      setWorkspace(data)
      setActiveLineId((current) => current && data.lines.some((line) => line.id === current) ? current : data.lines.find((line) => !line.currentAssignment)?.id ?? data.lines[0]?.id ?? null)
    } catch (loadError) {
      if (requestId !== workspaceRequestRef.current) return
      if ((loadError as { name?: string })?.name !== 'AbortError') {
        setError(loadError instanceof Error ? loadError.message : t('appointments.seatPlanner.loadError', 'Failed to load seat planner.'))
      }
    } finally {
      if (requestId === workspaceRequestRef.current) setIsLoading(false)
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
  const resourceColumnWidths = React.useMemo(() => {
    const widths = new Map<string, number>()
    for (const seat of seatColumns) {
      const maxLanes = Math.max(1, ...(allocationsBySeat.get(seat.id) ?? []).map((allocation) => allocation.lanesCount))
      widths.set(seat.id, maxLanes >= 3 ? Math.max(SEAT_COLUMN_WIDTH, maxLanes * OVERLAPPED_LANE_MIN_WIDTH + 8) : SEAT_COLUMN_WIDTH)
    }
    return widths
  }, [allocationsBySeat, seatColumns])
  const activeLine = React.useMemo(() => workspace?.lines.find((line) => line.id === activeLineId) ?? null, [activeLineId, workspace?.lines])
  const earliestDate = workspace ? new Date(workspace.appointment.requestedStartAt) : null
  const earliestMinutes = earliestDate ? earliestDate.getHours() * 60 + earliestDate.getMinutes() : START_HOUR * 60
  const bodyHeight = ((END_HOUR - START_HOUR) * 60 / SLOT_MINUTES) * slotHeight()
  const gridTemplateColumns = `${TIME_COLUMN_WIDTH}px ${seatColumns.map((seat) => `${resourceColumnWidths.get(seat.id) ?? SEAT_COLUMN_WIDTH}px`).join(' ')}`
  const boardWidth = TIME_COLUMN_WIDTH + seatColumns.reduce((width, seat) => width + (resourceColumnWidths.get(seat.id) ?? SEAT_COLUMN_WIDTH), 0)
  const isSaving = guardedMutation.isPending
  const canConfirm = Boolean(workspace?.lines.length) && Boolean(workspace?.lines.every((line) => Boolean(line.currentAssignment))) && !isSaving

  const saveDraft = React.useCallback(async (line: SeatPlannerLine, resourceId: string, startsAt: string, duration: number, assignedMemberId?: string | null) => {
    if (!workspace) return
    const body = { resourceId, startsAt, endsAt: addMinutes(startsAt, duration), assignedMemberId: assignedMemberId ?? line.currentAssignment?.assignedMemberId ?? null }
    const resourceName = seatColumns.find((resource) => resource.id === resourceId)?.name ?? null
    const optimisticAssignment = {
      id: line.currentAssignment?.id ?? `optimistic-${line.id}`,
      state: 'draft' as const,
      resourceId,
      resourceName,
      startsAt,
      endsAt: body.endsAt,
      assignedMemberId: body.assignedMemberId,
      assignedMemberName: line.currentAssignment?.assignedMemberName ?? null,
    }
    setWorkspace((current) => current ? {
      ...current,
      lines: current.lines.map((entry) => entry.id === line.id ? { ...entry, currentAssignment: optimisticAssignment } : entry),
    } : current)

    try {
      const assignment = await guardedMutation.runMutation({
        operation: () => readApiResultOrThrow<DraftAssignmentResult>(`/api/appointments/${encodeURIComponent(workspace.appointment.id)}/lines/${encodeURIComponent(line.id)}/draft`, { method: 'PUT', body: JSON.stringify(body) }),
        context: { appointmentId: workspace.appointment.id, lineId: line.id, resourceKind: 'appointments.seatPlannerDraft' },
        mutationPayload: body,
      })
      setWorkspace((current) => current ? {
        ...current,
        lines: current.lines.map((entry) => entry.id === line.id ? {
          ...entry,
          currentAssignment: {
            id: assignment.id,
            state: assignment.state,
            resourceId: assignment.resourceId,
            resourceName: assignment.resourceName ?? resourceName,
            startsAt: assignment.startsAt,
            endsAt: assignment.endsAt,
            assignedMemberId: assignment.assignedMemberId ?? null,
            assignedMemberName: assignment.assignedMemberName ?? null,
          },
        } : entry),
      } : current)
    } catch (error) {
      await loadWorkspace()
      throw error
    }
  }, [guardedMutation, loadWorkspace, seatColumns, workspace])

  const clearDraft = React.useCallback(async (lineId: string) => {
    if (!workspace) return
    const confirmed = await confirm({
      title: t('appointments.seatPlanner.clearDraftTitle', 'Clear assignment?'),
      description: t('appointments.seatPlanner.clearDraftDescription', 'Are you sure you want to clear the scheduled time and seat for this service?'),
      confirmText: t('appointments.seatPlanner.clear', 'Clear'),
      variant: 'destructive',
    })
    if (!confirmed) return

    setWorkspace((current) => current ? {
      ...current,
      lines: current.lines.map((line) => line.id === lineId ? { ...line, currentAssignment: undefined } : line),
      allocations: current.allocations.filter((allocation) => !(allocation.appointmentId === current.appointment.id && allocation.lineId === lineId)),
    } : current)
    try {
      await guardedMutation.runMutation({
        operation: () => readApiResultOrThrow(`/api/appointments/${encodeURIComponent(workspace.appointment.id)}/lines/${encodeURIComponent(lineId)}/draft`, { method: 'DELETE' }),
        context: { appointmentId: workspace.appointment.id, lineId, resourceKind: 'appointments.seatPlannerDraft' },
        mutationPayload: { appointmentId: workspace.appointment.id, lineId },
      })
    } catch (error) {
      await loadWorkspace()
      throw error
    }
    setPopoverState(null)
    flash(t('appointments.seatPlanner.draftCleared', 'Draft cleared'), 'success')
  }, [confirm, guardedMutation, loadWorkspace, t, workspace])

  const handleSlotClick = React.useCallback(async (resourceId: string, time: string) => {
    if (!workspace || !activeLine) return
    const startMinutes = timeToMinutes(time)
    if (startMinutes < earliestMinutes) {
      flash(t('appointments.seatPlanner.beforeEarliestError', 'This booking cannot start before the requested time.'), 'error')
      return
    }
    const activeIndex = workspace.lines.findIndex((line) => line.id === activeLine.id)
    let nextStart = buildIsoFromSlot(workspace.appointment.requestedStartAt, time)
    const plannedAssignments: Array<{ line: SeatPlannerLine; startsAt: string; duration: number }> = []
    for (const line of workspace.lines.slice(Math.max(0, activeIndex))) {
      if (line.id !== activeLine.id && line.currentAssignment) break
      const duration = lineDuration(line)
      const endsAt = addMinutes(nextStart, duration)
      const overlapping = (allocationsBySeat.get(resourceId) ?? []).some((allocation) => {
        if (allocation.appointmentId === workspace.appointment.id) return false
        return new Date(nextStart).getTime() < new Date(allocation.endsAt).getTime()
          && new Date(allocation.startsAt).getTime() < new Date(endsAt).getTime()
      })
      if (overlapping) {
        flash(t('appointments.seatPlanner.resourceBooked', 'That resource is already booked for this time.'), 'error')
        return
      }
      plannedAssignments.push({ line, startsAt: nextStart, duration })
      nextStart = endsAt
    }
    for (const assignment of plannedAssignments) {
      await saveDraft(assignment.line, resourceId, assignment.startsAt, assignment.duration)
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
    const nextEndsAt = addMinutes(allocation.startsAt, nextDuration)
    const overlapping = (allocationsBySeat.get(allocation.resourceId) ?? []).some((candidate) => {
      if (candidate.appointmentId === workspace.appointment.id) return false
      return new Date(allocation.startsAt).getTime() < new Date(candidate.endsAt).getTime()
        && new Date(candidate.startsAt).getTime() < new Date(nextEndsAt).getTime()
    })
    if (overlapping) {
      flash(t('appointments.seatPlanner.resourceBooked', 'That resource is already booked for this time.'), 'error')
      return
    }
    await saveDraft(line, allocation.resourceId, allocation.startsAt, nextDuration, allocation.assignedMemberId ?? null)
    setPopoverState(null)
  }, [allocationsBySeat, flash, saveDraft, t, workspace])

  const handleAssignStaff = React.useCallback(async (target: StaffSheetTarget, staffId: string | null) => {
    const line = target.line
    if (!line || target.allocation.appointmentId !== workspace?.appointment.id) return
    if (staffId === null && !target.allocation.assignedMemberId) return
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
    const seatOffset = seatColumns.slice(0, Math.max(0, seatIndex)).reduce((width, seat) => width + (resourceColumnWidths.get(seat.id) ?? SEAT_COLUMN_WIDTH), TIME_COLUMN_WIDTH)
    timelineRef.current.scrollTo({ top: Math.max(0, allocationTop(first) - 80), left: Math.max(0, seatOffset - 120), behavior: 'smooth' })
  }, [ownAllocations, resourceColumnWidths, seatColumns])

  const scrollServiceIntoView = React.useCallback((lineId: string) => {
    const service = document.querySelector<HTMLElement>(`[data-seat-planner-line-id="${lineId}"]`)
    service?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  const scrollTimelineToAllocation = React.useCallback((allocation: PlannerAllocation) => {
    const timeline = timelineRef.current
    const block = timeline?.querySelector<HTMLElement>(`[data-seat-planner-allocation-id="${allocation.id}"]`)
    if (!timeline || !block) return

    const timelineRect = timeline.getBoundingClientRect()
    const blockRect = block.getBoundingClientRect()
    const headerBottom = timelineRect.top + HEADER_HEIGHT
    const visibleBottom = timelineRect.bottom
    const visibleLeft = timelineRect.left + TIME_COLUMN_WIDTH
    let top = 0
    let left = 0

    if (blockRect.top < headerBottom) top = blockRect.top - headerBottom - 16
    else if (blockRect.bottom > visibleBottom) top = blockRect.bottom - visibleBottom + 16
    if (blockRect.left < visibleLeft) left = blockRect.left - visibleLeft - 16
    else if (blockRect.right > timelineRect.right) left = blockRect.right - timelineRect.right + 16

    if (top !== 0 || left !== 0) timeline.scrollBy({ top, left, behavior: 'smooth' })
  }, [])

  const handleLineSelect = React.useCallback((lineId: string) => {
    setActiveLineId(lineId)
    setMobileSidebarOpen(false)
    const assignment = workspace?.lines.find((line) => line.id === lineId)?.currentAssignment
    if (assignment) {
      scrollTimelineToAllocation({
        id: assignment.id,
        appointmentId: workspace.appointment.id,
        lineId,
        resourceId: assignment.resourceId,
        resourceName: assignment.resourceName,
        serviceName: workspace.lines.find((line) => line.id === lineId)?.productTitle ?? '',
        customerName: workspace.appointment.customerName,
        startsAt: assignment.startsAt,
        endsAt: assignment.endsAt,
        state: assignment.state,
        assignedMemberId: assignment.assignedMemberId,
        assignedMemberName: assignment.assignedMemberName,
        laneIndex: 0,
        lanesCount: 1,
      })
    }
  }, [scrollTimelineToAllocation, workspace])

  if (isLoading) {
    return <SeatPlannerLoadingSkeleton />
  }

  if (error || !workspace) {
    return (
      <Page fill className="!gap-0 !space-y-0">
        <PageBody fill>
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <ErrorMessage label={error ?? t('appointments.seatPlanner.loadError', 'Failed to load seat planner.')} />
            <Button type="button" variant="outline" onClick={() => void loadWorkspace()}>{t('common.retry', 'Retry')}</Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page fill className="!gap-0 !space-y-0 -mx-4 -mb-1 -mt-4 overflow-hidden sm:-mx-6 lg:-mx-8 lg:-mt-5">
      <PageBody fill className="!space-y-0 overflow-hidden p-0">
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
          <header className="shrink-0 border-b border-border bg-surface">
            <div className="px-3 py-2.5 sm:px-4 sm:py-3">
              <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                <IconButton asChild variant="ghost" aria-label={t('common.back', 'Back')}>
                  <Link href={`/backend/appointments/${workspace.appointment.id}`}><ArrowLeft className="size-4" /></Link>
                </IconButton>
                <IconButton type="button" variant="outline" className="lg:hidden" aria-label={t('appointments.seatPlanner.openSidebar', 'Open booking details')} onClick={() => setMobileSidebarOpen(true)}>
                  <Menu className="size-4" />
                </IconButton>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-base font-semibold">{activeLine?.productTitle ?? t('appointments.seatPlanner.resourcesTitle', 'Resources')}</h1>
                </div>
                <IconButton type="button" variant="outline" className="shrink-0 lg:hidden" aria-label={t('appointments.seatPlanner.confirmSchedule', 'Confirm schedule')} disabled={!canConfirm} onClick={() => void handleConfirmAll()}>
                  <Check className="size-4" />
                </IconButton>
                <Button type="button" className="hidden shrink-0 lg:inline-flex" disabled={!canConfirm} onClick={() => void handleConfirmAll()}>
                  <Check className="size-4" />
                  <span>{t('appointments.seatPlanner.confirmSchedule', 'Confirm schedule')}</span>
                </Button>
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            {mobileSidebarOpen ? <div className="fixed inset-0 z-40 bg-foreground/20 lg:hidden" onClick={() => setMobileSidebarOpen(false)} /> : null}
            <aside className={`fixed inset-y-0 left-0 z-50 flex flex-col min-h-0 w-full max-w-sm border-r border-border bg-surface shadow-lg transition-transform lg:static lg:z-auto lg:w-80 lg:translate-x-0 lg:shadow-none ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3 lg:hidden">
                <p className="text-sm font-semibold">{t('appointments.seatPlanner.bookingDetails', 'Booking details')}</p>
                <IconButton type="button" variant="ghost" aria-label={t('common.close', 'Close')} onClick={() => setMobileSidebarOpen(false)}><PanelLeftClose className="size-4" /></IconButton>
              </div>
              <div className="flex-1 min-h-0">
                <BookingSidebar
                  workspace={workspace}
                  activeLineId={activeLineId}
                  canManage
                  isSaving={isSaving}
                  onSelectLine={handleLineSelect}
                  onClearLine={(lineId) => void clearDraft(lineId)}
                  onPreviewAction={() => flash(t('appointments.seatPlanner.frontendPreview', 'This action is wired as a frontend preview for now.'), 'info')}
                />
              </div>
            </aside>

            <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Clock className="size-4 text-muted-foreground" />
                  <span className="text-xs font-semibold uppercase tracking-wider">{t('appointments.seatPlanner.seatsStations', 'Resources')}</span>
                  <Tag variant="neutral">{seatColumns.length} {t('appointments.seatPlanner.seats', 'resources')}</Tag>
                </div>
              </div>

              <div ref={timelineRef} className="min-h-0 flex-1 overflow-auto bg-muted/20">
                {seatColumns.length === 0 ? (
                  <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">{t('appointments.seatPlanner.noSeats', 'No resources are available for this organization.')}</div>
                ) : (
                  <div style={{ minWidth: boardWidth }}>
                    <div className="relative" style={{ height: bodyHeight + HEADER_HEIGHT }}>
                      <div className="sticky top-0 z-40 grid border-b border-border bg-surface shadow-sm" style={{ gridTemplateColumns }}>
                        <div className="sticky left-0 top-0 z-50 flex items-center justify-center border-r border-border bg-surface px-3 text-xs font-semibold uppercase tracking-wider" style={{ height: HEADER_HEIGHT }}>
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
                        <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-status-warning-border" style={{ top: Math.max(0, ((earliestMinutes - START_HOUR * 60) / SLOT_MINUTES) * slotHeight()) }} />
                        <div className="sticky left-0 z-30 border-r border-border bg-surface">
                          {slotGridMarkers.map((time) => (
                            <div key={`time-slot-${time}`} className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-border/60" style={{ top: slotTop(time) }} />
                          ))}
                          {timeMarkers.map((time) => (
                            <div key={time} className="absolute left-0 right-0 border-t border-dashed border-border" style={{ top: slotTop(time) }}>
                              <span className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap bg-surface px-1 text-xs text-muted-foreground ${time === timeMarkers[0] ? 'top-2' : time === timeMarkers[timeMarkers.length - 1] ? '-mt-1 -translate-y-full' : '-translate-y-1/2'}`}>{time}</span>
                            </div>
                          ))}
                        </div>

                        {seatColumns.map((seat) => (
                          <div key={seat.id} className={`relative border-r border-border bg-surface ${seat.isFirstInFloor ? 'border-l' : ''}`}>
                            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-muted/60" style={{ height: Math.max(0, ((earliestMinutes - START_HOUR * 60) / SLOT_MINUTES) * slotHeight()) }} />
                            {slotGridMarkers.map((time) => <div key={`${seat.id}-${time}-slot-grid`} className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-border/60" style={{ top: slotTop(time) }} />)}
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
                                  disabled={!activeLine}
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
                                    if (allocation.appointmentId === workspace.appointment.id) {
                                      setActiveLineId(allocation.lineId)
                                      scrollServiceIntoView(allocation.lineId)
                                    }
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
            staff={staffMembers}
            isLoadingStaff={isLoadingStaff}
            isLoadingMoreStaff={isLoadingMoreStaff}
            hasMoreStaff={hasMoreStaff}
            busyStaffIds={busyStaffIds}
            isSaving={isSaving}
            onClose={() => setStaffSheetTarget(null)}
            onAssign={(staffId) => void handleAssignStaff(staffSheetTarget, staffId)}
            onDurationChange={(nextDuration) => void handleDurationChange(staffSheetTarget.allocation, nextDuration)}
            onLoadMore={() => void loadStaffPage(staffPageRef.current + 1)}
          />
        ) : null}

        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
