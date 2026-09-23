'use client'

import * as React from 'react'
import { CalendarDays } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { resolveRegisteredLucideIconNode } from '@open-mercato/ui/backend/icons/lucideRegistry'

const START_HOUR = 8
const END_HOUR = 22
const SLOT_MINUTES = 15
const HOUR_HEIGHT = 88
const TIME_COLUMN_WIDTH = 72
const RESOURCE_COLUMN_WIDTH = 184
const HEADER_HEIGHT = 80
const TIME_LABEL_EDGE_GAP = 8

export type AppointmentResourceTimelineResource = {
  id: string
  name: string
  code?: string | null
  areaName?: string | null
  appearanceIcon?: string | null
  capacityUnitIcon?: string | null
  capacityUnitColor?: string | null
  typeIcon?: string | null
  typeColor?: string | null
  availabilityWindows?: Array<{ startsAt: string; endsAt: string }> | null
}

export type AppointmentResourceTimelineAppointment = {
  id: string
  customerName: string
  customerSalutation: string | null
  bookingType?: string | null
  statusCode?: string | null
}

export type AppointmentResourceTimelineBlock = {
  id: string
  appointmentId: string
  resourceId: string | null
  startsAt: string
  endsAt: string
  state: 'draft' | 'confirmed'
  serviceName: string
  serviceCategory?: string | null
  services?: Array<{
    name: string
    category: string | null
    startsAt: string
    endsAt: string
  }>
}

type AppointmentResourceTimelineProps = {
  date: string
  resources: AppointmentResourceTimelineResource[]
  appointments: AppointmentResourceTimelineAppointment[]
  blocks: AppointmentResourceTimelineBlock[]
  fitScreen?: boolean
  placementMode?: boolean
  placementStartAt?: string | null
  onSlotClick?: (resourceId: string, startsAt: string) => void
  renderAppointmentPopover?: (
    appointment: AppointmentResourceTimelineAppointment,
    block: AppointmentResourceTimelineBlock,
    close: () => void,
    bounds: { startMinutes: number; endMinutes: number },
  ) => React.ReactNode
}

function displayTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function timeToMinutes(value: string) {
  const [hour = '0', minute = '0'] = value.split(':')
  return Number(hour) * 60 + Number(minute)
}

function slotTop(value: string, hourHeight: number, timelineStartMinutes: number) {
  return ((timeToMinutes(value) - timelineStartMinutes) / SLOT_MINUTES) * (hourHeight / (60 / SLOT_MINUTES))
}

function allocationTop(value: string, hourHeight: number, timelineStartMinutes: number) {
  const date = new Date(value)
  return (((date.getHours() * 60 + date.getMinutes()) - timelineStartMinutes) / SLOT_MINUTES) * (hourHeight / (60 / SLOT_MINUTES))
}

function allocationHeight(startsAt: string, endsAt: string, hourHeight: number) {
  return Math.max(24, ((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000 / SLOT_MINUTES) * (hourHeight / (60 / SLOT_MINUTES)))
}

function minutesToTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function buildSlots(timelineStartMinutes: number, timelineEndMinutes: number) {
  const slots: string[] = []
  for (let minutes = timelineStartMinutes; minutes < timelineEndMinutes; minutes += SLOT_MINUTES) slots.push(minutesToTime(minutes))
  return slots
}

function buildTimeMarkers(timelineStartMinutes: number, timelineEndMinutes: number) {
  const markers: string[] = []
  const firstHour = Math.ceil(timelineStartMinutes / 60) * 60
  for (let minutes = firstHour; minutes <= timelineEndMinutes; minutes += 60) markers.push(minutesToTime(minutes))
  if (markers.length === 0 || timeToMinutes(markers[0]) !== timelineStartMinutes) markers.unshift(minutesToTime(timelineStartMinutes))
  if (timeToMinutes(markers[markers.length - 1]) !== timelineEndMinutes) markers.push(minutesToTime(timelineEndMinutes))
  return markers
}

function resourceSupportsRange(
  resource: AppointmentResourceTimelineResource | undefined,
  startsAt: string,
  endsAt: string,
) {
  if (!resource || resource.availabilityWindows === null || resource.availabilityWindows === undefined) return true
  const start = new Date(startsAt).getTime()
  const end = new Date(endsAt).getTime()
  return resource.availabilityWindows.some((window) => {
    const windowStart = new Date(window.startsAt).getTime()
    const windowEnd = new Date(window.endsAt).getTime()
    return start >= windowStart && end <= windowEnd
  })
}

function groupAppointmentBlocks(blocks: AppointmentResourceTimelineBlock[]) {
  const grouped = new Map<string, AppointmentResourceTimelineBlock[]>()
  for (const block of blocks) {
    const key = `${block.appointmentId}:${block.resourceId ?? 'unassigned'}`
    grouped.set(key, [...(grouped.get(key) ?? []), block])
  }

  return [...grouped.values()].map((group) => {
    const first = group[0]
    const startsAt = group.reduce((earliest, block) => block.startsAt < earliest ? block.startsAt : earliest, first.startsAt)
    const endsAt = group.reduce((latest, block) => block.endsAt > latest ? block.endsAt : latest, first.endsAt)
    return {
      ...first,
      startsAt,
      endsAt,
      state: group.every((block) => block.state === 'confirmed') ? 'confirmed' as const : 'draft' as const,
      serviceName: group.map((block) => block.serviceName).filter((name, index, names) => names.indexOf(name) === index).join(', '),
      services: group
        .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())
        .map((block) => ({ name: block.serviceName, category: block.serviceCategory ?? null, startsAt: block.startsAt, endsAt: block.endsAt })),
    }
  })
}

function isAppointmentPopoverOverlayTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('[data-appointment-staff-assignment-sheet="true"], [data-appointment-add-service-dialog="true"]'))
}

function resourceIcon(resource: AppointmentResourceTimelineResource) {
  const iconName = resource.appearanceIcon ?? resource.capacityUnitIcon ?? resource.typeIcon ?? null
  const iconNode = resolveRegisteredLucideIconNode(iconName ?? undefined, 'size-4')
  if (iconNode) return iconNode
  if (iconName) return <span className="text-sm leading-none" aria-hidden="true">{iconName}</span>
  return <CalendarDays className="size-4" />
}

function AppointmentBlockRibbons({ appointment }: { appointment: AppointmentResourceTimelineAppointment }) {
  const t = useT()
  const isBookingForm = appointment.bookingType === 'booking_form'
  const isDepositReceived = appointment.statusCode === 'deposit_received_booked'
  if (!isBookingForm && !isDepositReceived) return null

  return (
    <span className="pointer-events-none absolute right-0 top-0 z-10 h-12 w-12 overflow-hidden rounded-tr-md">
      {isBookingForm ? <span className="absolute right-[-24px] top-1.5 w-[5.25rem] rotate-45 bg-status-info-icon py-0.5 text-center text-[8px] font-extrabold uppercase leading-none tracking-wide text-primary-foreground shadow-sm">{t('appointments.overview.ribbon.form', 'Form')}</span> : null}
      {isDepositReceived ? <span className="absolute right-[-28px] top-3.5 w-[6.5rem] rotate-45 bg-status-success-icon py-0.5 text-center text-[8px] font-extrabold uppercase leading-none tracking-wide text-primary-foreground shadow-sm">{t('appointments.overview.ribbon.deposit', 'Deposit')}</span> : null}
    </span>
  )
}

function TimelineAppointmentBlock({
  appointment,
  block,
  hourHeight,
  timelineStartMinutes,
  timelineEndMinutes,
  renderPopover,
  placementMode,
}: {
  appointment: AppointmentResourceTimelineAppointment
  block: AppointmentResourceTimelineBlock
  hourHeight: number
  timelineStartMinutes: number
  timelineEndMinutes: number
  placementMode?: boolean
  renderPopover?: AppointmentResourceTimelineProps['renderAppointmentPopover']
}) {
  const [open, setOpen] = React.useState(false)
  const services = block.services ?? [{ name: block.serviceName, category: block.serviceCategory ?? null, startsAt: block.startsAt, endsAt: block.endsAt }]
  const blockHeight = allocationHeight(block.startsAt, block.endsAt, hourHeight) - 6
  const isCompact = blockHeight < 176
  const isVeryCompact = blockHeight < 124
  const hasRibbon = appointment.bookingType === 'booking_form' || appointment.statusCode === 'deposit_received_booked'
  const trigger = (
    <Button
      type="button"
      variant="ghost"
      className={`absolute left-0 right-0 z-20 min-h-6 items-start justify-start overflow-hidden rounded-md border text-left shadow-sm ${isCompact ? 'p-1' : 'p-1.5'} ${block.state === 'confirmed' ? 'border-status-success-border bg-status-success-bg text-status-success-text' : 'border-status-warning-border bg-status-warning-bg text-status-warning-text'} ${placementMode ? 'pointer-events-none border-2 border-primary bg-primary/10 text-muted-foreground' : ''}`}
      style={{ top: allocationTop(block.startsAt, hourHeight, timelineStartMinutes) + 3, height: blockHeight }}
    >
      <AppointmentBlockRibbons appointment={appointment} />
        <span className="block min-w-0">
        <span className={cn('block truncate font-semibold', isCompact ? 'text-xs' : 'text-sm', hasRibbon ? 'pr-8' : '')}>{appointment.customerSalutation ? `${appointment.customerSalutation}. ` : ''}{appointment.customerName}</span>
        <span className={cn('block space-y-1 border-t border-current/15', isCompact ? 'mt-1 pt-1' : 'mt-1.5 pt-1.5')}>
          {services.slice(0, isVeryCompact ? 1 : services.length).map((service) => (
            <span key={`${service.name}-${service.startsAt}`} className="block min-w-0">
              <span className="flex items-baseline justify-between gap-2">
                <span className={cn('truncate font-semibold', isCompact ? 'text-[11px]' : 'text-xs')}>{service.name}</span>
                <span className={cn('shrink-0 opacity-75', isCompact ? 'text-[10px]' : 'text-[11px]')}>{displayTime(service.startsAt)} - {displayTime(service.endsAt)}</span>
              </span>
              {!isVeryCompact && service.category ? <span className="block truncate text-[11px] opacity-75">{service.category}</span> : null}
            </span>
          ))}
        </span>
        {!isVeryCompact ? <span className="mt-1 block truncate text-xs opacity-80">{displayTime(block.startsAt)} - {displayTime(block.endsAt)}</span> : null}
      </span>
    </Button>
  )

  if (!renderPopover) return trigger

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="center"
        side="bottom"
        sideOffset={6}
        collisionPadding={16}
        className="flex w-80 max-w-full flex-col overflow-hidden p-0 shadow-xl"
        style={{ maxHeight: 'min(38rem, var(--radix-popover-content-available-height))' }}
        onPointerDownOutside={(event) => {
          if (isAppointmentPopoverOverlayTarget(event.detail.originalEvent.target)) event.preventDefault()
        }}
        onFocusOutside={(event) => {
          if (isAppointmentPopoverOverlayTarget(event.detail.originalEvent.target)) event.preventDefault()
        }}
      >
        <div className={cn('h-1 w-full shrink-0', block.state === 'confirmed' ? 'bg-status-success-icon' : 'bg-status-warning-icon')} />
        {renderPopover(appointment, block, () => setOpen(false), { startMinutes: timelineStartMinutes, endMinutes: timelineEndMinutes })}
      </PopoverContent>
    </Popover>
  )
}

export function AppointmentResourceTimeline({ date, resources, appointments, blocks, fitScreen = false, placementMode = false, placementStartAt = null, renderAppointmentPopover, onSlotClick }: AppointmentResourceTimelineProps) {
  const t = useT()
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const [viewportSize, setViewportSize] = React.useState({ width: 0, height: 0 })

  React.useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const updateSize = () => setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight })
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const appointmentById = React.useMemo(() => new Map(appointments.map((appointment) => [appointment.id, appointment])), [appointments])
  const groupedBlocks = React.useMemo(() => groupAppointmentBlocks(blocks), [blocks])
  const resourceColumnWidth = fitScreen && viewportSize.width > 0 && resources.length > 0
    ? Math.max(RESOURCE_COLUMN_WIDTH, (viewportSize.width - TIME_COLUMN_WIDTH) / resources.length)
    : RESOURCE_COLUMN_WIDTH
  const canvasWidth = TIME_COLUMN_WIDTH + resources.length * resourceColumnWidth
  const canvasScale = fitScreen && viewportSize.width > 0 && canvasWidth > viewportSize.width
    ? viewportSize.width / canvasWidth
    : 1
  const timelineBounds = React.useMemo(() => {
    const startCandidates: number[] = []
    const endCandidates: number[] = []
    for (const resource of resources) {
      const windows = resource.availabilityWindows
      if (windows === null || windows === undefined) {
        startCandidates.push(START_HOUR * 60)
        endCandidates.push(END_HOUR * 60)
        continue
      }
      for (const window of windows) {
        const start = new Date(window.startsAt)
        const end = new Date(window.endsAt)
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue
        startCandidates.push(start.getHours() * 60 + start.getMinutes())
        endCandidates.push(end.getHours() * 60 + end.getMinutes())
      }
    }
    const startMinutes = startCandidates.length > 0 ? Math.min(...startCandidates) : START_HOUR * 60
    const endMinutes = endCandidates.length > 0 ? Math.max(...endCandidates) : END_HOUR * 60
    return {
      startMinutes: Math.floor(startMinutes / SLOT_MINUTES) * SLOT_MINUTES,
      endMinutes: Math.ceil(endMinutes / SLOT_MINUTES) * SLOT_MINUTES,
    }
  }, [resources])
  const slots = React.useMemo(() => buildSlots(timelineBounds.startMinutes, timelineBounds.endMinutes), [timelineBounds])
  const timeMarkers = React.useMemo(() => buildTimeMarkers(timelineBounds.startMinutes, timelineBounds.endMinutes), [timelineBounds])
  const timelineHours = (timelineBounds.endMinutes - timelineBounds.startMinutes) / 60
  const timelineHeight = fitScreen && viewportSize.height > 0
    ? Math.max(viewportSize.height / canvasScale - HEADER_HEIGHT - 2 - TIME_LABEL_EDGE_GAP * 2, 300)
    : timelineHours * HOUR_HEIGHT
  const hourHeight = timelineHeight / timelineHours
  const canvasHeight = HEADER_HEIGHT + timelineHeight + TIME_LABEL_EDGE_GAP * 2
  const gridTemplateColumns = `${TIME_COLUMN_WIDTH}px ${resources.map(() => `${resourceColumnWidth}px`).join(' ')}`
  const placementMinutes = placementStartAt ? new Date(placementStartAt).getHours() * 60 + new Date(placementStartAt).getMinutes() : null
  const placementTimeTop = placementMinutes !== null && placementMinutes >= timelineBounds.startMinutes && placementMinutes <= timelineBounds.endMinutes
    ? ((placementMinutes - timelineBounds.startMinutes) / 60) * hourHeight
    : null

  React.useEffect(() => {
    const viewport = viewportRef.current
    if (!placementMode || fitScreen || placementTimeTop === null || !viewport) return
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollTo({ top: Math.max(0, HEADER_HEIGHT + TIME_LABEL_EDGE_GAP + placementTimeTop - 50), behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [fitScreen, placementMode, placementTimeTop])

  return (
    <div ref={viewportRef} className={cn('isolate h-full min-h-0', fitScreen ? 'overflow-hidden' : 'overflow-auto')}>
      <div style={{ width: canvasWidth * canvasScale, height: canvasHeight * canvasScale }}>
        <div
          className="min-w-max"
          style={{
            width: canvasWidth,
            height: canvasHeight,
            transform: canvasScale === 1 ? undefined : `scale(${canvasScale})`,
            transformOrigin: 'top left',
          }}
        >
          <div className="sticky top-0 z-40 grid border-b border-border bg-surface shadow-sm" style={{ gridTemplateColumns }}>
            <div className="sticky left-0 z-50 flex items-center justify-center border-r border-border bg-surface px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ height: HEADER_HEIGHT }}>{t('appointments.overview.time', 'Time')}</div>
            {resources.map((resource, index) => {
              const previousResource = resources[index - 1]
              const startsArea = index === 0 || previousResource?.areaName !== resource.areaName
              const areaName = resource.areaName ?? t('appointments.seatPlanner.mainFloor', 'Main floor')
              return <div key={resource.id} className={cn('flex flex-col justify-center gap-2 overflow-hidden border-r border-border bg-surface px-3 py-2', startsArea && 'border-l')}><div className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{areaName}</div><div className="flex min-w-0 items-center gap-2"><span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted" style={{ color: resource.typeColor ?? resource.capacityUnitColor ?? undefined }}>{resourceIcon(resource)}</span><div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{resource.code || resource.name}</p><p className="truncate text-xs text-muted-foreground">{resource.name}</p></div></div></div>
            })}
          </div>
          <div className="relative" style={{ height: timelineHeight + TIME_LABEL_EDGE_GAP * 2 }}>
            <div className="relative grid" style={{ height: timelineHeight, top: TIME_LABEL_EDGE_GAP, gridTemplateColumns }}>
              <div className="sticky left-0 z-30 border-r border-border bg-surface">{timeMarkers.map((time) => <div key={time} className="absolute left-0 right-0 border-t border-dashed border-border" style={{ top: slotTop(time, hourHeight, timelineBounds.startMinutes) }}><span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap bg-surface px-1 text-xs text-muted-foreground">{time}</span></div>)}</div>
            {resources.map((resource) => {
              const resourceBlocks = groupedBlocks.filter((block) => block.resourceId === resource.id)
              return (
                <div key={resource.id} className="relative border-r border-border bg-surface">
                  {slots.map((startsAt, index) => {
                    const minutes = timeToMinutes(startsAt)
                    const slotStartsAt = new Date(`${date}T${startsAt}:00`)
                    const slotEndsAt = new Date(slotStartsAt.getTime() + SLOT_MINUTES * 60000)
                    const isOccupied = resourceBlocks.some((block) => (
                      slotStartsAt.getTime() < new Date(block.endsAt).getTime()
                      && slotEndsAt.getTime() > new Date(block.startsAt).getTime()
                    ))
                    const isUnavailable = !resourceSupportsRange(resource, slotStartsAt.toISOString(), slotEndsAt.toISOString())
                    const isBeforePlacementTime = placementMinutes !== null && minutes < placementMinutes
                    const isBlocked = isOccupied || isUnavailable || isBeforePlacementTime
                    const slotHeight = hourHeight / (60 / SLOT_MINUTES)
                    return (
                      <React.Fragment key={`${resource.id}-${startsAt}`}>
                        <div className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-border/60" style={{ top: index * slotHeight }} />
                        {isUnavailable || isBeforePlacementTime ? <div className="pointer-events-none absolute inset-x-0 z-0 bg-muted/60" style={{ top: index * slotHeight, height: slotHeight }} /> : null}
                        {onSlotClick ? <button type="button" disabled={isBlocked} aria-label={`${resource.name} ${startsAt}`} className={cn('absolute inset-x-0 z-10 border-0 bg-transparent', isBlocked ? 'cursor-not-allowed opacity-40' : 'hover:bg-primary/5')} style={{ top: index * slotHeight, height: slotHeight }} onClick={() => onSlotClick(resource.id, startsAt)} /> : null}
                      </React.Fragment>
                    )
                  })}
                  {resourceBlocks.map((block) => {
                    const appointment = appointmentById.get(block.appointmentId)
                    if (!appointment) return null
                    return <TimelineAppointmentBlock key={`${block.appointmentId}-${block.resourceId}`} appointment={appointment} block={block} hourHeight={hourHeight} timelineStartMinutes={timelineBounds.startMinutes} timelineEndMinutes={timelineBounds.endMinutes} placementMode={placementMode} renderPopover={renderAppointmentPopover} />
                  })}
                </div>
              )
            })}
            {placementMode && placementTimeTop !== null ? <div className="pointer-events-none absolute right-0 z-30 bg-muted/40" style={{ left: TIME_COLUMN_WIDTH, top: 0, height: placementTimeTop }} /> : null}
            {placementMode && placementTimeTop !== null ? <div className="pointer-events-none absolute right-0 z-40 border-t-2 border-status-warning-icon" style={{ left: TIME_COLUMN_WIDTH, top: placementTimeTop }} /> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
