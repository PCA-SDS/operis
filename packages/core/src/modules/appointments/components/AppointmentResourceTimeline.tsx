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

export type AppointmentResourceTimelineResource = {
  id: string
  name: string
  appearanceIcon?: string | null
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
  organizationName: string
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
  ) => React.ReactNode
}

function displayTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function timeToMinutes(value: string) {
  const [hour = '0', minute = '0'] = value.split(':')
  return Number(hour) * 60 + Number(minute)
}

function slotTop(value: string, hourHeight: number) {
  return ((timeToMinutes(value) - START_HOUR * 60) / SLOT_MINUTES) * (hourHeight / (60 / SLOT_MINUTES))
}

function allocationTop(value: string, hourHeight: number) {
  const date = new Date(value)
  return (((date.getHours() * 60 + date.getMinutes()) - START_HOUR * 60) / SLOT_MINUTES) * (hourHeight / (60 / SLOT_MINUTES))
}

function allocationHeight(startsAt: string, endsAt: string, hourHeight: number) {
  return Math.max(24, ((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000 / SLOT_MINUTES) * (hourHeight / (60 / SLOT_MINUTES)))
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

function resourceIcon(resource: AppointmentResourceTimelineResource) {
  return resolveRegisteredLucideIconNode(resource.appearanceIcon ?? undefined, 'size-4') ?? <CalendarDays className="size-4" />
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
  renderPopover,
  placementMode,
}: {
  appointment: AppointmentResourceTimelineAppointment
  block: AppointmentResourceTimelineBlock
  hourHeight: number
  placementMode?: boolean
  renderPopover?: AppointmentResourceTimelineProps['renderAppointmentPopover']
}) {
  const [open, setOpen] = React.useState(false)
  const services = block.services ?? [{ name: block.serviceName, category: block.serviceCategory ?? null, startsAt: block.startsAt, endsAt: block.endsAt }]
  const blockHeight = allocationHeight(block.startsAt, block.endsAt, hourHeight) - 6
  const isCompact = blockHeight < 176
  const isVeryCompact = blockHeight < 124
  const trigger = (
    <Button
      type="button"
      variant="ghost"
      className={`absolute left-0 right-0 min-h-6 justify-start overflow-hidden rounded-md border text-left shadow-sm ${isCompact ? 'p-1.5' : 'p-2'} ${block.state === 'confirmed' ? 'border-status-success-border bg-status-success-bg text-status-success-text' : 'border-status-warning-border bg-status-warning-bg text-status-warning-text'} ${placementMode ? 'pointer-events-none border-2 border-primary bg-primary/10 text-muted-foreground' : ''}`}
      style={{ top: allocationTop(block.startsAt, hourHeight) + 3, height: blockHeight }}
    >
      <AppointmentBlockRibbons appointment={appointment} />
        <span className="block min-w-0">
        <span className={cn('block truncate font-semibold', isCompact ? 'text-xs' : 'text-sm')}>{appointment.customerSalutation ? `${appointment.customerSalutation}. ` : ''}{appointment.customerName}</span>
        <span className={cn('block space-y-1 border-t border-current/15', isCompact ? 'mt-1 pt-1' : 'mt-2 pt-2')}>
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
      >
        <div className={cn('h-1 w-full shrink-0', block.state === 'confirmed' ? 'bg-status-success-icon' : 'bg-status-warning-icon')} />
        {renderPopover(appointment, block, () => setOpen(false))}
      </PopoverContent>
    </Popover>
  )
}

export function AppointmentResourceTimeline({ organizationName, resources, appointments, blocks, fitScreen = false, placementMode = false, placementStartAt = null, renderAppointmentPopover, onSlotClick }: AppointmentResourceTimelineProps) {
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
  const timelineHeight = fitScreen && viewportSize.height > 0
    ? Math.max(viewportSize.height / canvasScale - HEADER_HEIGHT - 2, 300)
    : (END_HOUR - START_HOUR) * HOUR_HEIGHT
  const hourHeight = timelineHeight / (END_HOUR - START_HOUR)
  const canvasHeight = HEADER_HEIGHT + timelineHeight
  const gridTemplateColumns = `${TIME_COLUMN_WIDTH}px ${resources.map(() => `${resourceColumnWidth}px`).join(' ')}`
  const timeMarkers = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => `${String(START_HOUR + index).padStart(2, '0')}:00`)
  const placementMinutes = placementStartAt ? new Date(placementStartAt).getHours() * 60 + new Date(placementStartAt).getMinutes() : null
  const placementTimeTop = placementMinutes !== null && placementMinutes >= START_HOUR * 60 && placementMinutes <= END_HOUR * 60
    ? ((placementMinutes - START_HOUR * 60) / 60) * hourHeight
    : null

  React.useEffect(() => {
    const viewport = viewportRef.current
    if (!placementMode || fitScreen || placementTimeTop === null || !viewport) return
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollTo({ top: Math.max(0, HEADER_HEIGHT + placementTimeTop - 50), behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [fitScreen, placementMode, placementTimeTop])

  return (
    <div ref={viewportRef} className={cn('h-full min-h-0', fitScreen ? 'overflow-hidden' : 'overflow-auto')}>
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
          <div className="sticky top-0 z-10 grid border-b border-border bg-surface shadow-sm" style={{ gridTemplateColumns }}>
            <div className="sticky left-0 z-20 flex items-center justify-center border-r border-border bg-surface px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ height: HEADER_HEIGHT }}>{t('appointments.overview.time', 'Time')}</div>
            {resources.map((resource) => <div key={resource.id} className="flex flex-col justify-center gap-2 overflow-hidden border-r border-border bg-surface px-3 py-2"><div className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{organizationName}</div><div className="flex items-center gap-2"><span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-primary">{resourceIcon(resource)}</span><span className="truncate text-sm font-semibold text-foreground">{resource.name}</span></div></div>)}
          </div>
          <div className="relative grid" style={{ height: timelineHeight, gridTemplateColumns }}>
            <div className="sticky left-0 z-30 border-r border-border bg-surface">{timeMarkers.map((time) => <div key={time} className="absolute left-0 right-0 border-t border-dashed border-border" style={{ top: slotTop(time, hourHeight) }}><span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap bg-surface px-1 text-xs text-muted-foreground">{time}</span></div>)}</div>
            {resources.map((resource) => {
              const resourceBlocks = groupedBlocks.filter((block) => block.resourceId === resource.id)
              return <div key={resource.id} className="relative border-r border-border bg-surface">{Array.from({ length: ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES }, (_, index) => { const minutes = START_HOUR * 60 + index * SLOT_MINUTES; const startsAt = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; const isOccupied = resourceBlocks.some((block) => { const blockStart = new Date(block.startsAt); const blockEnd = new Date(block.endsAt); const slotStart = blockStart.getHours() * 60 + blockStart.getMinutes(); const slotEnd = blockEnd.getHours() * 60 + blockEnd.getMinutes(); return minutes < slotEnd && minutes + SLOT_MINUTES > slotStart }); const isBeforePlacementTime = placementMinutes !== null && minutes < placementMinutes; return <React.Fragment key={`${resource.id}-${index}`}><div className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-border/60" style={{ top: index * (hourHeight / (60 / SLOT_MINUTES)) }} />{onSlotClick && (!placementMode || (!isOccupied && !isBeforePlacementTime)) ? <button type="button" aria-label={`${resource.name} ${startsAt}`} className="absolute inset-x-0 z-0 border-0 bg-transparent hover:bg-primary/5" style={{ top: index * (hourHeight / (60 / SLOT_MINUTES)), height: hourHeight / (60 / SLOT_MINUTES) }} onClick={() => onSlotClick(resource.id, startsAt)} /> : null}</React.Fragment> })}{resourceBlocks.map((block) => { const appointment = appointmentById.get(block.appointmentId); if (!appointment) return null; return <TimelineAppointmentBlock key={`${block.appointmentId}-${block.resourceId}`} appointment={appointment} block={block} hourHeight={hourHeight} placementMode={placementMode} renderPopover={renderAppointmentPopover} /> })}</div>
            })}
            {placementMode && placementTimeTop !== null ? <div className="pointer-events-none absolute right-0 z-30 bg-muted/40" style={{ left: TIME_COLUMN_WIDTH, top: 0, height: placementTimeTop }} /> : null}
            {placementMode && placementTimeTop !== null ? <div className="pointer-events-none absolute right-0 z-40 border-t-2 border-status-warning-icon" style={{ left: TIME_COLUMN_WIDTH, top: placementTimeTop }} /> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
