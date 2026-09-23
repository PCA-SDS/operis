'use client'

// optimistic-lock-exempt: overview scheduling actions are command-level transitions; the server validates the appointment resource and the overview payload does not carry a record version.

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { BadgeDollarSign, CalendarDays, Check, Clock, Copy, ExternalLink, Inbox, Maximize2, Minimize2, MoreHorizontal, Pencil, Plus, RotateCcw, Timer, Trash2, Users, X } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { TimePicker } from '@open-mercato/ui/backend/inputs/TimePicker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@open-mercato/ui/primitives/sheet'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useOrganizationScopeDetail, useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { AppointmentServicePicker, hasCompleteAppointmentServiceOptions, type AppointmentBookableService, type AppointmentServiceSelection } from '../../../components/AppointmentServicePicker'
import { AppointmentResourceTimeline } from '../../../components/AppointmentResourceTimeline'
import { AppointmentStaffAssignmentSheet, type AppointmentAssignableStaff } from '../../../components/AppointmentStaffAssignmentSheet'
import { BookingOverviewCreateSheet } from '../../../components/BookingOverviewCreateSheet'
import { groupSeatPlannerOptions } from '../../../lib/seatPlannerOptions'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { getAppointmentPermissionSet } from '../../../lib/permissions'

type Resource = { id: string; name: string; code: string | null; appearanceIcon: string | null; capacityUnitIcon: string | null; capacityUnitColor: string | null; typeIcon: string | null; typeColor: string | null; areaName: string | null; availabilityWindows: Array<{ startsAt: string; endsAt: string }> | null }
type Line = { id: string; productId: string; productTitle: string; productCategory: string | null; durationMinutes: number | null; options?: Array<{ groupName: string | null; name: string }> }
type Appointment = {
  id: string
  organizationId: string
  customerName: string
  customerSalutation: string | null
  customerPhone: string | null
  customerPhoneCountryCode: string | null
  bookingType: string | null
  statusCode: string
  requestedStartAt: string
  requestedEndAt: string | null
  lines: Line[]
}
type Block = { id: string; appointmentId: string; lineId: string; resourceId: string | null; resourceName: string | null; assignedMemberId: string | null; assignedMemberName: string | null; startsAt: string; endsAt: string; state: 'draft' | 'confirmed'; serviceName: string; serviceCategory: string | null }
type Overview = { date: string; organization: { id: string; name: string }; resources: Resource[]; appointments: Appointment[]; blocks: Block[]; unassignedAppointmentIds: string[]; unconfirmedAppointmentIds: string[]; unconfirmedAppointments: Appointment[] }
type OrganizationNode = { id: string; name: string; selectable: boolean; children?: OrganizationNode[] }
const DEPOSIT_RECEIVED_STATUS_CODE = 'deposit_received_booked'
const STAFF_PAGE_SIZE = 50

function BookingLineOptions({ options }: { options: NonNullable<Line['options']> }) {
  const t = useT()
  const groups = groupSeatPlannerOptions(options)
  if (groups.length === 0) return null

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('appointments.seatPlanner.options', 'Options')}</p>
      {groups.map((group) => (
        <div key={group.groupName ?? 'option'} className="flex flex-col gap-0.5">
          {group.groupName ? <p className="font-medium text-muted-foreground">{group.groupName}</p> : null}
          <div className={group.groupName ? 'pl-3' : undefined}>
            {group.names.map((name, optionIndex) => (
              <span key={name} className="mr-2 inline-flex items-center text-foreground">
                {optionIndex > 0 && <span className="mr-1 opacity-40">•</span>}
                <span className="font-medium">{name}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function selectedLineOptions(service: AppointmentBookableService, selectedOptions?: AppointmentServiceSelection['selectedOptions']) {
  const options: NonNullable<Line['options']> = []
  const values = selectedOptions ?? {}

  const collect = (groups: AppointmentBookableService['optionGroups'], parentPath = '') => {
    for (const group of groups) {
      const groupPath = parentPath ? `${parentPath}/${group.id}` : group.id
      const selectedValue = values[groupPath] ?? values[group.id]
      const selectedIds = typeof selectedValue === 'string' ? [selectedValue] : selectedValue ?? []
      for (const optionId of selectedIds) {
        const option = group.options.find((entry) => entry.id === optionId)
        if (!option) continue
        options.push({ groupName: group.name, name: option.name })
        collect(option.nextGroups, `${groupPath}/${option.id}`)
      }
    }
  }

  collect(service.optionGroups)
  return options
}

function today() { return new Date().toISOString().slice(0, 10) }
function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}
function serializeDate(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
function displayTime(value: string) { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
function addMinutes(value: string, minutes: number) { return new Date(new Date(value).getTime() + minutes * 60000).toISOString() }
function flattenOrganizations(nodes: OrganizationNode[]): OrganizationNode[] {
  return nodes.flatMap((node) => [node, ...flattenOrganizations(node.children ?? [])])
}
function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'signal is aborted without reason')
}

function timeInputValue(value: string) {
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function updateTimeValue(value: string, time: string) {
  const date = new Date(value)
  const [hours = '0', minutes = '0'] = time.split(':')
  date.setHours(Number(hours), Number(minutes), 0, 0)
  return date.toISOString()
}

function timeToMinutes(value: string) {
  const [hours = '0', minutes = '0'] = value.split(':')
  return Number(hours) * 60 + Number(minutes)
}

function minutesToTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function buildTimeSlots(startMinutes: number, endMinutes: number) {
  const slots: string[] = []
  for (let minutes = startMinutes; minutes <= endMinutes; minutes += 15) slots.push(minutesToTime(minutes))
  return slots
}

function BookingScheduleEditor({ block, timelineStartMinutes, timelineEndMinutes, onSave }: { block: Block; timelineStartMinutes: number; timelineEndMinutes: number; onSave: (startsAt: string, endsAt: string) => Promise<boolean> }) {
  const t = useT()
  const [startTime, setStartTime] = React.useState(() => timeInputValue(block.startsAt))
  const [endTime, setEndTime] = React.useState(() => timeInputValue(block.endsAt))
  const saveQueueRef = React.useRef<Promise<void>>(Promise.resolve())
  const gridSlots = React.useMemo(() => buildTimeSlots(timelineStartMinutes, timelineEndMinutes), [timelineEndMinutes, timelineStartMinutes])

  React.useEffect(() => {
    setStartTime(timeInputValue(block.startsAt))
    setEndTime(timeInputValue(block.endsAt))
  }, [block.endsAt, block.id, block.startsAt])

  const startSlots = React.useMemo(() => {
    const endMinutes = timeToMinutes(endTime)
    return gridSlots.filter((slot) => timeToMinutes(slot) <= endMinutes - 15)
  }, [endTime, gridSlots])
  const endSlots = React.useMemo(() => {
    const startMinutes = timeToMinutes(startTime)
    return gridSlots.filter((slot) => timeToMinutes(slot) >= startMinutes + 15)
  }, [gridSlots, startTime])

  const saveSchedule = React.useCallback((nextStartTime: string, nextEndTime: string, previousStartTime: string, previousEndTime: string) => {
    const startsAt = updateTimeValue(block.startsAt, nextStartTime)
    const endsAt = updateTimeValue(block.endsAt, nextEndTime)
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return

    const saveTask = saveQueueRef.current.then(async () => {
      try {
        const saved = await onSave(startsAt, endsAt)
        if (!saved) {
          setStartTime((current) => current === nextStartTime ? previousStartTime : current)
          setEndTime((current) => current === nextEndTime ? previousEndTime : current)
        }
      } catch {
        setStartTime((current) => current === nextStartTime ? previousStartTime : current)
        setEndTime((current) => current === nextEndTime ? previousEndTime : current)
      }
    })
    saveQueueRef.current = saveTask.then(() => undefined, () => undefined)
  }, [block.endsAt, block.startsAt, onSave])

  const handleTimeChange = (field: 'start' | 'end', value: string | null) => {
    if (!value) return
    const nextStartTime = field === 'start' ? value : startTime
    const nextEndTime = field === 'end' ? value : endTime
    if (nextStartTime === startTime && nextEndTime === endTime) return
    if (timeToMinutes(nextEndTime) <= timeToMinutes(nextStartTime)) return

    const previousStartTime = startTime
    const previousEndTime = endTime
    setStartTime(nextStartTime)
    setEndTime(nextEndTime)
    saveSchedule(nextStartTime, nextEndTime, previousStartTime, previousEndTime)
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 space-y-1">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('appointments.overview.time', 'Time')}</span>
          <TimePicker value={startTime} onChange={(value) => handleTimeChange('start', value)} slots={startSlots} minuteStep={15} showNowButton={false} showClearButton={false} showFooter={false} closeOnChange className="h-8 px-2 text-xs" aria-label={t('appointments.overview.time', 'Time')} />
        </label>
        <label className="min-w-0 space-y-1">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('appointments.overview.end', 'End')}</span>
          <TimePicker value={endTime} onChange={(value) => handleTimeChange('end', value)} slots={endSlots} minuteStep={15} showNowButton={false} showClearButton={false} showFooter={false} closeOnChange className="h-8 px-2 text-xs" aria-label={t('appointments.overview.end', 'End')} />
        </label>
      </div>
    </div>
  )
}

function BookingQuickPopover({
  appointment,
  anchorBlock,
  blocks,
  close,
  onCopy,
  onDepositChange,
  onDelete,
  onDeleteService,
  onAddService,
  onAssignStaff,
  onOpenSeatPlanner,
  onScheduleChange,
  timelineStartMinutes,
  timelineEndMinutes,
  canCreate,
  canManage,
  canViewSeatPlanner,
}: {
  appointment: Appointment
  anchorBlock: Block
  blocks: Block[]
  close: () => void
  onCopy: (appointment: Appointment) => Promise<void>
  onDepositChange: (appointment: Appointment) => Promise<boolean>
  onDelete: (appointment: Appointment) => Promise<boolean>
  onDeleteService: (appointment: Appointment, line: Line) => Promise<boolean>
  onAddService: (appointment: Appointment) => void
  onAssignStaff: (appointment: Appointment, line: Line, block: Block | null) => void
  onOpenSeatPlanner: (appointmentId: string) => void
  onScheduleChange: (appointment: Appointment, line: Line, block: Block, startsAt: string, endsAt: string) => Promise<boolean>
  timelineStartMinutes: number
  timelineEndMinutes: number
  canCreate: boolean
  canManage: boolean
  canViewSeatPlanner: boolean
}) {
  const t = useT()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [deletingLineId, setDeletingLineId] = React.useState<string | null>(null)
  const appointmentBlocks = blocks.filter((block) => block.appointmentId === appointment.id)
  const startsAt = appointmentBlocks.reduce((earliest, block) => block.startsAt < earliest ? block.startsAt : earliest, anchorBlock.startsAt)
  const endsAt = appointmentBlocks.reduce((latest, block) => block.endsAt > latest ? block.endsAt : latest, anchorBlock.endsAt)
  const durationMinutes = Math.max(0, Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000))

  return (
    <>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {appointment.customerSalutation ? `${appointment.customerSalutation}. ` : ''}{appointment.customerName}
          </p>
          <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" asChild>
            <Link href={`/backend/appointments/${appointment.id}`} aria-label={t('appointments.overview.editCustomer', 'Edit customer')}><Pencil className="size-3.5" /></Link>
          </Button>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canViewSeatPlanner ? (
            <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => onOpenSeatPlanner(appointment.id)} aria-label={t('appointments.overview.editBooking', 'Edit booking')}>
              <Pencil className="size-3.5" />
            </Button>
          ) : null}
          {canCreate ? (
            <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => { close(); void onCopy(appointment) }} aria-label={t('appointments.overview.copy', 'Copy booking')}><Copy className="size-3.5" /></Button>
          ) : null}
          {canManage ? (
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t('appointments.list.columns.actions', 'Actions')}><MoreHorizontal className="size-4" /></Button></PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-1">
                <Button type="button" variant="ghost" className="w-full justify-start gap-2" disabled={appointment.statusCode === DEPOSIT_RECEIVED_STATUS_CODE} onClick={async () => { setMenuOpen(false); if (await onDepositChange(appointment)) close() }}><BadgeDollarSign className="size-4" />{appointment.statusCode === DEPOSIT_RECEIVED_STATUS_CODE ? t('appointments.overview.payment.received', 'Deposit received') : t('appointments.overview.payment.mark', 'Deposit')}</Button>
                <Button type="button" variant="ghost" className="w-full justify-start gap-2 text-destructive hover:text-destructive" onClick={() => { setMenuOpen(false); setDeleteDialogOpen(true) }}><Trash2 className="size-4" />{t('appointments.list.actions.delete', 'Delete')}</Button>
              </PopoverContent>
            </Popover>
          ) : null}
          <Button type="button" variant="ghost" size="icon" className="size-8" onClick={close} aria-label={t('ui.close', 'Close')}><X className="size-4" /></Button>
        </div>
      </div>

      <p className="mt-1 line-clamp-2 text-sm font-medium text-foreground">{appointment.lines.map((line) => line.productTitle).join(', ')}</p>

      <div className="mt-3 grid grid-cols-3 gap-3 rounded-md bg-muted px-2.5 py-2 text-xs">
        <div className="col-span-2 min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><Clock className="size-3.5" />{t('appointments.overview.time', 'Time')}</div>
          <p className="mt-1 whitespace-nowrap text-sm font-semibold tabular-nums">{displayTime(startsAt)} - {displayTime(endsAt)}</p>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><Timer className="size-3.5" />{t('appointments.overview.duration', 'Duration')}</div>
          <p className="mt-1 whitespace-nowrap text-sm font-semibold tabular-nums">{durationMinutes} min</p>
        </div>
      </div>

      <div className="mt-3 rounded-md bg-muted/60 p-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('appointments.overview.services', 'Services & time')}</p>
          {canManage ? (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2" asChild>
              <button type="button" onClick={() => onAddService(appointment)}><Plus className="mr-1 size-3.5" />{t('appointments.overview.add', 'Add')}</button>
            </Button>
          ) : null}
        </div>
        <div className="space-y-2">
          {appointment.lines.map((line) => {
            const block = appointmentBlocks.find((candidate) => candidate.lineId === line.id)
            return (
              <div key={line.id} className="border-t border-border pt-2 text-xs first:border-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-foreground">{line.productTitle}</p>
                  {canManage ? <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="-mr-1 -mt-1 size-7 shrink-0 text-destructive hover:text-destructive"
                    disabled={deletingLineId !== null}
                    aria-label={t('appointments.overview.deleteService', 'Delete service')}
                    onClick={async () => {
                      setDeletingLineId(line.id)
                      await onDeleteService(appointment, line)
                      setDeletingLineId(null)
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button> : null}
                </div>
                {line.productCategory ? <p className="mt-0.5 text-muted-foreground">{line.productCategory}</p> : null}
                <BookingLineOptions options={line.options ?? []} />
                {canManage ? <button type="button" className="mt-1 flex items-center gap-1 text-left text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60" disabled={!block} onClick={() => onAssignStaff(appointment, line, block ?? null)}><Users className="size-3.5" />{block?.assignedMemberName ?? t('appointments.overview.noStaff', 'No staff assigned')}</button> : <span className="mt-1 flex items-center gap-1 text-muted-foreground"><Users className="size-3.5" />{block?.assignedMemberName ?? t('appointments.overview.noStaff', 'No staff assigned')}</span>}
                {block && canManage ? <BookingScheduleEditor block={block} timelineStartMinutes={timelineStartMinutes} timelineEndMinutes={timelineEndMinutes} onSave={(startsAt, endsAt) => onScheduleChange(appointment, line, block, startsAt, endsAt)} /> : <div className="mt-2 grid grid-cols-2 gap-2 tabular-nums"><div className="rounded-md bg-input-bg px-2 py-1.5"><span className="mr-2 text-muted-foreground">{t('appointments.overview.time', 'Time')}</span>{block ? displayTime(block.startsAt) : '—'}</div><div className="rounded-md bg-input-bg px-2 py-1.5"><span className="mr-2 text-muted-foreground">{t('appointments.overview.end', 'End')}</span>{block ? displayTime(block.endsAt) : '—'}</div></div>}
              </div>
            )
          })}
          {canManage ? (
            <Button type="button" variant="outline" size="sm" className="w-full border-dashed" asChild>
              <button type="button" onClick={() => onAddService(appointment)}><Plus className="mr-1 size-3.5" />{t('appointments.overview.addService', 'Add service')}</button>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-2">
          {canManage ? <Button type="button" variant="outline" size="sm" className="flex-1" disabled={appointment.statusCode === DEPOSIT_RECEIVED_STATUS_CODE} onClick={async () => { if (await onDepositChange(appointment)) close() }}>{appointment.statusCode === DEPOSIT_RECEIVED_STATUS_CODE ? <Check className="mr-1.5 size-3.5" /> : null}{appointment.statusCode === DEPOSIT_RECEIVED_STATUS_CODE ? t('appointments.overview.payment.received', 'Deposit received') : t('appointments.overview.payment.mark', 'Mark deposit received')}</Button> : null}
          <Button type="button" variant="outline" size="icon" className="size-8" asChild><Link href={`/backend/appointments/${appointment.id}`} aria-label={t('appointments.overview.openDetail', 'Open detail')}><ExternalLink className="size-3.5" /></Link></Button>
        </div>
      </div>
    </div>
    <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
      <DialogContent size="sm" elevated>
        <DialogHeader><DialogTitle>{t('appointments.list.actions.deleteConfirm', 'Delete this appointment?')}</DialogTitle></DialogHeader>
        <DialogDescription>{t('appointments.list.actions.deleteConfirm', 'Delete this appointment?')}</DialogDescription>
        <DialogFooter>
          <Button type="button" variant="soft" disabled={isDeleting} onClick={() => setDeleteDialogOpen(false)}>{t('appointments.config.statuses.dialog.cancel', 'Cancel')}</Button>
          <Button type="button" variant="destructive-solid" disabled={isDeleting} onClick={async () => { setIsDeleting(true); const deleted = await onDelete(appointment); setIsDeleting(false); if (!deleted) return; setDeleteDialogOpen(false); close() }}><Trash2 className="mr-2 size-4" />{t('appointments.list.actions.delete', 'Delete')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}

export default function BookingOverviewPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const { organizationId: scopedOrganizationId, tenantId } = useOrganizationScopeDetail()
  const { payload: backendChromePayload, isReady: backendChromeReady } = useBackendChrome()
  const { canCreate, canManage, canViewSeatPlanner } = getAppointmentPermissionSet(
    backendChromePayload?.grantedFeatures,
    backendChromeReady,
  )
  const [date, setDate] = React.useState(() => searchParams.get('date') ?? today())
  const [organizationId, setOrganizationId] = React.useState(() => searchParams.get('organizationId') ?? scopedOrganizationId ?? '')
  const [organizations, setOrganizations] = React.useState<OrganizationNode[]>([])
  const [overview, setOverview] = React.useState<Overview | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isFitScreen, setIsFitScreen] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [serviceDialogAppointment, setServiceDialogAppointment] = React.useState<Appointment | null>(null)
  const [bookableServices, setBookableServices] = React.useState<AppointmentBookableService[]>([])
  const [selectedServices, setSelectedServices] = React.useState<AppointmentServiceSelection[]>([])
  const [isLoadingServices, setIsLoadingServices] = React.useState(false)
  const [serviceLoadError, setServiceLoadError] = React.useState<string | null>(null)
  const [isAddingService, setIsAddingService] = React.useState(false)
  const [silentReload, setSilentReload] = React.useState(false)
  const [createBookingSlot, setCreateBookingSlot] = React.useState<{ date: string; time: string; resourceId: string; resourceName: string } | null>(null)
  const [unconfirmedOpen, setUnconfirmedOpen] = React.useState(false)
  const [placementAppointment, setPlacementAppointment] = React.useState<Appointment | null>(null)
  const [isAssigning, setIsAssigning] = React.useState(false)
  const [staffSheetTarget, setStaffSheetTarget] = React.useState<{ appointmentId: string; lineId: string; target: { serviceName: string; resourceName: string | null; startsAt: string; endsAt: string; assignedMemberId: string | null; assignedMemberName: string | null } } | null>(null)
  const [staffMembers, setStaffMembers] = React.useState<AppointmentAssignableStaff[]>([])
  const [isLoadingStaff, setIsLoadingStaff] = React.useState(false)
  const [isLoadingMoreStaff, setIsLoadingMoreStaff] = React.useState(false)
  const [hasMoreStaff, setHasMoreStaff] = React.useState(true)
  const [isSavingStaff, setIsSavingStaff] = React.useState(false)
  const suppressRealtimeReloadRef = React.useRef(false)
  const staffPageRef = React.useRef(0)
  const staffLoadingRef = React.useRef(false)
  const hasMoreStaffRef = React.useRef(true)

  const reload = React.useCallback((withoutPageLoading = false) => {
    setSilentReload(withoutPageLoading)
    setReloadToken((value) => value + 1)
  }, [])
  useAppEvent('appointments.appointment.*', (event) => {
    if (suppressRealtimeReloadRef.current) return
    reload()
  }, [reload])

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function loadOrganizations() {
      try {
        const call = await apiCall<{ items?: OrganizationNode[] }>('/api/directory/organization-switcher', { signal: controller.signal }, { fallback: { items: [] } })
        if (!cancelled && call.ok) setOrganizations(call.result?.items ?? [])
      } catch (error) {
        if (!cancelled && !controller.signal.aborted && !isAbortError(error)) flash(t('appointments.overview.error.organizations', 'Unable to load organizations.'), 'error')
      }
    }
    void loadOrganizations()
    return () => { cancelled = true; controller.abort() }
  }, [scopeVersion])

  React.useEffect(() => {
    let cancelled = false
    let timedOut = false
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 15000)
    async function loadOverview() {
      try {
        if (!silentReload) setIsLoading(true)
        const params = new URLSearchParams({ date })
        if (organizationId) params.set('organizationId', organizationId)
        const call = await apiCall<Overview>(`/api/appointments/overview?${params.toString()}`, { signal: controller.signal }, { fallback: null })
        if (cancelled) return
        if (!call.ok || !call.result) {
          flash(t('appointments.overview.error.load', 'Unable to load booking overview.'), 'error')
          setOverview(null)
        } else {
          setOverview(call.result)
          if (!organizationId) setOrganizationId(call.result.organization.id)
        }
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          if (!cancelled && timedOut) {
            flash(t('appointments.overview.error.timeout', 'Booking overview took too long to load.'), 'error')
            setOverview(null)
          }
          return
        }
        if (!cancelled) {
          flash(t('appointments.overview.error.load', 'Unable to load booking overview.'), 'error')
          setOverview(null)
        }
      } finally {
        window.clearTimeout(timeoutId)
        if (!cancelled) setIsLoading(false)
      }
    }
    void loadOverview()
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeoutId) }
  }, [date, organizationId, reloadToken, silentReload, t])

  React.useEffect(() => {
    if (!serviceDialogAppointment || !tenantId) return
    const controller = new AbortController()
    setIsLoadingServices(true)
    setServiceLoadError(null)
    const params = new URLSearchParams({ tenantId, organizationId: serviceDialogAppointment.organizationId })
    void apiCall<{ items?: AppointmentBookableService[]; error?: string }>(`/api/catalog/bookable-services?${params.toString()}`, { signal: controller.signal }, { fallback: null })
      .then((call) => {
        if (controller.signal.aborted) return
        if (!call.ok) {
          setBookableServices([])
          setServiceLoadError(call.result?.error ?? t('appointments.seatPlanner.servicesLoadError', 'Unable to load services.'))
          return
        }
        setBookableServices(call.result?.items ?? [])
      })
      .catch((error) => {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setBookableServices([])
          setServiceLoadError(t('appointments.seatPlanner.servicesLoadError', 'Unable to load services.'))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingServices(false)
      })
    return () => controller.abort()
  }, [serviceDialogAppointment, tenantId, t])

  const appointmentById = React.useMemo(() => new Map([...(overview?.appointments ?? []), ...(overview?.unconfirmedAppointments ?? [])].map((appointment) => [appointment.id, appointment])), [overview])
  const organizationOptions = React.useMemo(() => flattenOrganizations(organizations).filter((organization) => organization.selectable), [organizations])

  const selectOrganization = (nextOrganizationId: string) => {
    setOrganizationId(nextOrganizationId)
    document.cookie = `om_selected_org=${encodeURIComponent(nextOrganizationId)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`
    emitOrganizationScopeChanged({ organizationId: nextOrganizationId, tenantId: tenantId ?? null })
  }

  const openSeatPlanner = React.useCallback((appointmentId: string) => {
    if (organizationId) selectOrganization(organizationId)
    router.push(`/backend/appointments/${appointmentId}/seat-planner`)
  }, [organizationId, router, tenantId])

  const loadStaffPage = React.useCallback(async (page: number) => {
    if (staffLoadingRef.current || (page > 1 && !hasMoreStaffRef.current)) return
    staffLoadingRef.current = true
    if (page === 1) setIsLoadingStaff(true)
    else setIsLoadingMoreStaff(true)
    try {
      const response = await readApiResultOrThrow<{ items?: Array<{ id: string; displayName: string; teamName?: string | null }> }>(`/api/staff/team-members/assignable?page=${page}&pageSize=${STAFF_PAGE_SIZE}&includeUnlinked=true`)
      const nextStaff = (response.items ?? []).map((member) => ({ id: member.id, displayName: member.displayName, roleLabel: member.teamName ?? t('appointments.staffAssignment.member', 'Staff member') }))
      setStaffMembers((current) => {
        if (page === 1) return nextStaff
        const existingIds = new Set(current.map((member) => member.id))
        return [...current, ...nextStaff.filter((member) => !existingIds.has(member.id))]
      })
      staffPageRef.current = page
      const nextHasMore = nextStaff.length >= STAFF_PAGE_SIZE
      hasMoreStaffRef.current = nextHasMore
      setHasMoreStaff(nextHasMore)
    } catch {
      flash(t('appointments.staffAssignment.loadError', 'Unable to load staff.'), 'error')
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

  const openStaffAssignment = React.useCallback((appointment: Appointment, line: Line, block: Block | null) => {
    if (!block?.resourceId) return
    setStaffSheetTarget({ appointmentId: appointment.id, lineId: line.id, target: {
      serviceName: line.productTitle,
      resourceName: block.resourceName,
      startsAt: block.startsAt,
      endsAt: block.endsAt,
      assignedMemberId: block.assignedMemberId,
      assignedMemberName: block.assignedMemberName,
    } })
  }, [])

  const busyStaffIds = React.useMemo(() => {
    if (!staffSheetTarget || !overview) return new Set<string>()
    const targetStart = new Date(staffSheetTarget.target.startsAt).getTime()
    const targetEnd = new Date(staffSheetTarget.target.endsAt).getTime()
    const busy = new Set<string>()
    for (const block of overview.blocks) {
      if (block.appointmentId === staffSheetTarget.appointmentId && block.lineId === staffSheetTarget.lineId) continue
      if (!block.assignedMemberId) continue
      if (targetStart < new Date(block.endsAt).getTime() && new Date(block.startsAt).getTime() < targetEnd) busy.add(block.assignedMemberId)
    }
    return busy
  }, [overview, staffSheetTarget])

  const saveStaffAssignment = React.useCallback(async (staffId: string | null, duration?: number) => {
    if (!staffSheetTarget || !overview || isSavingStaff) return
    const block = overview.blocks.find((entry) => entry.appointmentId === staffSheetTarget.appointmentId && entry.lineId === staffSheetTarget.lineId)
    if (!block?.resourceId) return
    const nextEndsAt = duration === undefined ? block.endsAt : addMinutes(block.startsAt, duration)
    setIsSavingStaff(true)
    suppressRealtimeReloadRef.current = true
    try {
      const call = await apiCall(`/api/appointments/${staffSheetTarget.appointmentId}/lines/${staffSheetTarget.lineId}/draft`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resourceId: block.resourceId, startsAt: block.startsAt, endsAt: nextEndsAt, assignedMemberId: staffId, preserveState: true }),
      }, { fallback: null })
      if (!call.ok) {
        flash(t('appointments.staffAssignment.saveError', 'Unable to update staff assignment.'), 'error')
        return
      }
      setOverview((current) => current ? { ...current, blocks: current.blocks.map((entry) => entry.id === block.id ? { ...entry, endsAt: nextEndsAt, assignedMemberId: staffId, assignedMemberName: staffId ? staffMembers.find((member) => member.id === staffId)?.displayName ?? null : null } : entry) } : current)
      setStaffSheetTarget((current) => current ? { ...current, target: { ...current.target, endsAt: nextEndsAt, assignedMemberId: staffId, assignedMemberName: staffId ? staffMembers.find((member) => member.id === staffId)?.displayName ?? null : null } } : current)
      flash(staffId ? t('appointments.staffAssignment.assignedToast', 'Staff assigned.') : t('appointments.staffAssignment.removedToast', 'Staff removed.'), 'success')
    } finally {
      suppressRealtimeReloadRef.current = false
      setIsSavingStaff(false)
    }
  }, [isSavingStaff, overview, staffMembers, staffSheetTarget, t])

  const saveScheduleAssignment = React.useCallback(async (appointment: Appointment, line: Line, block: Block, startsAt: string, endsAt: string): Promise<boolean> => {
    if (!block.resourceId || new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return false
    suppressRealtimeReloadRef.current = true
    try {
      const call = await apiCall(`/api/appointments/${appointment.id}/lines/${line.id}/draft`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resourceId: block.resourceId, startsAt, endsAt, assignedMemberId: block.assignedMemberId, preserveState: true }),
      }, { fallback: null })
      if (!call.ok) {
        flash(t('appointments.staffAssignment.saveError', 'Unable to update staff assignment.'), 'error')
        return false
      }
      setOverview((current) => current ? { ...current, blocks: current.blocks.map((entry) => entry.id === block.id ? { ...entry, startsAt, endsAt } : entry) } : current)
      setStaffSheetTarget((current) => current && current.appointmentId === appointment.id && current.lineId === line.id
        ? { ...current, target: { ...current.target, startsAt, endsAt } }
        : current)
      flash(t('appointments.seatPlanner.saved', 'Assignment saved'), 'success')
      return true
    } finally {
      suppressRealtimeReloadRef.current = false
    }
  }, [t])

  const updateDeposit = async (appointment: Appointment): Promise<boolean> => {
    suppressRealtimeReloadRef.current = true
    try {
      const call = await apiCall(`/api/appointments/${appointment.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ statusCode: DEPOSIT_RECEIVED_STATUS_CODE }),
      }, { fallback: null })
      if (!call.ok) {
        flash(t('appointments.overview.payment.failed', 'Unable to update deposit.'), 'error')
        return false
      }
      flash(t('appointments.overview.payment.received', 'Deposit marked as received.'), 'success')
      reload(true)
      return true
    } finally {
      suppressRealtimeReloadRef.current = false
    }
  }

  const openAddService = (appointment: Appointment) => {
    setServiceDialogAppointment(appointment)
    setSelectedServices([])
  }

  const addServices = async () => {
    if (!serviceDialogAppointment || selectedServices.length === 0) return
    const selectedServiceById = new Map(bookableServices.map((service) => [service.id, service]))
    const hasIncompleteService = selectedServices.some((selection) => {
      const service = selectedServiceById.get(selection.productId)
      return service ? !hasCompleteAppointmentServiceOptions(service, selection) : true
    })
    if (hasIncompleteService) {
      flash(t('appointments.overview.serviceOptionsRequired', 'Please complete all required service options.'), 'error')
      return
    }
    setIsAddingService(true)
    suppressRealtimeReloadRef.current = true
    const addedLines: Line[] = []
    const addedBlocks: Block[] = []
    try {
      const appointmentBlocks = overview?.blocks.filter((block) => block.appointmentId === serviceDialogAppointment.id) ?? []
      const lastBlock = [...appointmentBlocks]
        .filter((block) => block.resourceId)
        .sort((left, right) => new Date(right.endsAt).getTime() - new Date(left.endsAt).getTime())[0]
      let nextStart = lastBlock?.endsAt ?? serviceDialogAppointment.requestedStartAt

      for (const selection of selectedServices) {
        const bookableService = selectedServiceById.get(selection.productId)
        if (!bookableService) continue
        const call = await apiCall<{ line?: { id: string; durationMinutes: number | null } }>(`/api/appointments/${serviceDialogAppointment.id}/lines`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(selection),
        }, { fallback: null })
        if (!call.ok) {
          flash(t('appointments.seatPlanner.serviceAddError', 'Unable to add service.'), 'error')
          return
        }
        const addedLine = call.result?.line
        if (!addedLine) {
          flash(t('appointments.seatPlanner.serviceAddError', 'Unable to add service.'), 'error')
          return
        }
        addedLines.push({
          id: addedLine.id,
          productId: bookableService.id,
          productTitle: bookableService.title,
          productCategory: bookableService.categoryName ?? null,
          durationMinutes: addedLine.durationMinutes ?? bookableService.durationMinutes ?? null,
          options: selectedLineOptions(bookableService, selection.selectedOptions),
        })
        if (lastBlock?.resourceId && addedLine?.id) {
          const duration = 60
          const endsAt = addMinutes(nextStart, duration)
          const assignment = await apiCall<{ id?: string; resourceId?: string; state?: 'draft' | 'confirmed'; startsAt?: string; endsAt?: string; assignedMemberId?: string | null }>(`/api/appointments/${serviceDialogAppointment.id}/lines/${addedLine.id}/draft`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ resourceId: lastBlock.resourceId, startsAt: nextStart, endsAt }),
          }, { fallback: null })
          if (!assignment.ok || !assignment.result?.id) {
            flash(t('appointments.overview.serviceSchedulingConflict', 'Service added, but it could not be scheduled because of a conflict. Opening Planner.'), 'error')
            setServiceDialogAppointment(null)
            setSelectedServices([])
            openSeatPlanner(serviceDialogAppointment.id)
            return
          }
          addedBlocks.push({
            id: assignment.result.id,
            appointmentId: serviceDialogAppointment.id,
            lineId: addedLine.id,
            resourceId: assignment.result.resourceId ?? lastBlock.resourceId,
            resourceName: lastBlock.resourceName,
            assignedMemberId: assignment.result.assignedMemberId ?? null,
            assignedMemberName: null,
            startsAt: assignment.result.startsAt ?? nextStart,
            endsAt: assignment.result.endsAt ?? endsAt,
            state: assignment.result.state ?? 'draft',
            serviceName: bookableService.title,
            serviceCategory: bookableService.categoryName ?? null,
          })
          nextStart = endsAt
        }
      }
      if (lastBlock?.resourceId) {
        const confirmation = await apiCall(`/api/appointments/${serviceDialogAppointment.id}/confirm-drafts`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }, { fallback: null })
        if (!confirmation.ok) {
          flash(t('appointments.overview.serviceSchedulingConflict', 'Service added, but it could not be scheduled because of a conflict. Opening Planner.'), 'error')
          setServiceDialogAppointment(null)
          setSelectedServices([])
          openSeatPlanner(serviceDialogAppointment.id)
          return
        }
      }
      const confirmedBlocks = addedBlocks.map((block) => ({ ...block, state: 'confirmed' as const }))
      setOverview((current) => {
        if (!current) return current
        const updateLines = (entry: Appointment) => entry.id === serviceDialogAppointment.id
          ? { ...entry, lines: [...entry.lines, ...addedLines] }
          : entry
        const appointments = current.appointments.map(updateLines)
        const unconfirmedAppointments = current.unconfirmedAppointments.map(updateLines)
        const blocks = [...current.blocks, ...confirmedBlocks]
        const assignedLineIds = new Set(blocks.filter((block) => block.resourceId).map((block) => block.lineId))
        return {
          ...current,
          appointments,
          unconfirmedAppointments,
          blocks,
          unassignedAppointmentIds: appointments
            .filter((entry) => entry.lines.some((entryLine) => !assignedLineIds.has(entryLine.id)))
            .map((entry) => entry.id),
        }
      })
      flash(t('appointments.seatPlanner.servicesAdded', 'Service added'), 'success')
      setServiceDialogAppointment(null)
      setSelectedServices([])
    } catch {
      flash(t('appointments.overview.serviceSchedulingConflict', 'Service added, but it could not be scheduled because of a conflict. Opening Planner.'), 'error')
      setServiceDialogAppointment(null)
      setSelectedServices([])
      openSeatPlanner(serviceDialogAppointment.id)
    } finally {
      suppressRealtimeReloadRef.current = false
      setIsAddingService(false)
    }
  }

  const deleteAppointment = async (appointment: Appointment) => {
    const call = await apiCall(`/api/appointments/${appointment.id}`, { method: 'DELETE' }, { fallback: null })
    if (!call.ok) {
      flash(t('appointments.delete.failed', 'Unable to delete appointment.'), 'error')
      return false
    }
    flash(t('appointments.delete.success', 'Appointment deleted.'), 'success')
    reload(true)
    return true
  }

  const deleteService = async (appointment: Appointment, line: Line) => {
    suppressRealtimeReloadRef.current = true
    try {
      const call = await apiCall(`/api/appointments/${appointment.id}/lines/${line.id}`, { method: 'DELETE' }, { fallback: null })
      if (!call.ok) {
        flash(t('appointments.overview.deleteServiceFailed', 'Unable to remove service.'), 'error')
        return false
      }
      flash(t('appointments.overview.deleteServiceSuccess', 'Service removed.'), 'success')
      setOverview((current) => {
        if (!current) return current
        const updateLines = (entry: Appointment) => entry.id === appointment.id
          ? { ...entry, lines: entry.lines.filter((entryLine) => entryLine.id !== line.id) }
          : entry
        const appointments = current.appointments.map(updateLines)
        const unconfirmedAppointments = current.unconfirmedAppointments.map(updateLines)
        const blocks = current.blocks.filter((block) => block.lineId !== line.id)
        const assignedLineIds = new Set(blocks.map((block) => block.lineId))
        return {
          ...current,
          appointments,
          unconfirmedAppointments,
          blocks,
          unassignedAppointmentIds: appointments
            .filter((entry) => entry.lines.some((entryLine) => !assignedLineIds.has(entryLine.id)))
            .map((entry) => entry.id),
        }
      })
      return true
    } finally {
      suppressRealtimeReloadRef.current = false
    }
  }

  const copyAppointment = async (appointment: Appointment) => {
    const call = await apiCall(`/api/appointments/${appointment.id}/clone`, { method: 'POST' }, { fallback: null })
    if (!call.ok) flash(t('appointments.clone.failed', 'Unable to clone appointment.'), 'error')
    else { flash(t('appointments.clone.success', 'Appointment cloned successfully'), 'success'); reload(true) }
  }

  const assignUnconfirmedToGrid = async (resourceId: string, startsAt: string) => {
    if (!placementAppointment || isAssigning) return
    setIsAssigning(true)
    suppressRealtimeReloadRef.current = true
    try {
      let nextStart = startsAt
      for (const line of placementAppointment.lines) {
        const endsAt = addMinutes(nextStart, line.durationMinutes ?? 60)
        const call = await apiCall(`/api/appointments/${placementAppointment.id}/lines/${line.id}/draft`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ resourceId, startsAt: nextStart, endsAt }),
        }, { fallback: null })
        if (!call.ok) {
          flash(t('appointments.overview.unconfirmedAssignFailed', 'Unable to assign booking to the grid.'), 'error')
          return
        }
        nextStart = endsAt
      }
      const confirmation = await apiCall(`/api/appointments/${placementAppointment.id}/confirm-drafts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }, { fallback: null })
      if (!confirmation.ok) {
        flash(t('appointments.overview.unconfirmedAssignFailed', 'Unable to assign booking to the grid.'), 'error')
        return
      }
      flash(t('appointments.overview.unconfirmedAssignSuccess', 'Booking assigned to the grid.'), 'success')
      setPlacementAppointment(null)
      setUnconfirmedOpen(false)
      reload(true)
    } finally {
      suppressRealtimeReloadRef.current = false
      setIsAssigning(false)
    }
  }

  const startUnconfirmedPlacement = (appointment: Appointment) => {
    setDate(appointment.requestedStartAt.slice(0, 10))
    setPlacementAppointment(appointment)
    setUnconfirmedOpen(false)
  }

  return (
    <Page fill className="min-h-0 overflow-hidden">
      <PageBody fill className={isFitScreen ? 'min-h-0 overflow-hidden p-0' : 'min-h-0 overflow-hidden'}>
        <div className="flex h-full min-h-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{t('appointments.overview.title', 'Booking Overview')}</h1>
              <p className="text-sm text-muted-foreground">{t('appointments.overview.description', 'Daily booking timeline')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {placementAppointment ? <Button type="button" variant="outline" disabled={isAssigning} onClick={() => setPlacementAppointment(null)}><Users className="mr-2 size-4" />{t('appointments.overview.placing', 'Placing: {{name}}').replace('{{name}}', placementAppointment.customerName)}<X className="ml-2 size-4" /></Button> : null}
              <DatePicker
                value={parseDate(date)}
                onChange={(value) => { if (value) setDate(serializeDate(value)) }}
                footer="none"
                className="w-52"
                aria-label={t('appointments.overview.date', 'Date')}
              />
              <Select value={organizationId} onValueChange={selectOrganization}>
                <SelectTrigger className="w-[12rem]"><SelectValue placeholder={t('appointments.overview.organization', 'Organization')} /></SelectTrigger>
                <SelectContent>{organizationOptions.map((organization) => <SelectItem key={organization.id} value={organization.id}>{organization.name}</SelectItem>)}</SelectContent>
              </Select>
              <Button type="button" variant="outline" onClick={() => setDate(today())}><CalendarDays className="mr-2 size-4" />{t('appointments.overview.today', 'Today')}</Button>
              <Button type="button" variant="outline" onClick={() => reload()}><RotateCcw className="size-4" /></Button>
              <Button type="button" variant="outline" onClick={() => setUnconfirmedOpen(true)}>
                <Inbox className="mr-2 size-4" />
                {t('appointments.overview.unconfirmed', 'Unconfirmed')}
                <span className="ml-1 rounded-full bg-status-warning-bg px-1.5 text-xs text-status-warning-text">{overview?.unconfirmedAppointmentIds.length ?? 0}</span>
              </Button>
              <Button type="button" variant={isFitScreen ? 'default' : 'outline'} onClick={() => setIsFitScreen((value) => !value)}>{isFitScreen ? <Minimize2 className="mr-2 size-4" /> : <Maximize2 className="mr-2 size-4" />}{t('appointments.overview.fitScreen', 'Fit screen')}</Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-muted/20">
            {isLoading ? <div className="flex min-h-96 items-center justify-center text-sm text-muted-foreground">{t('appointments.overview.loading', 'Loading booking overview…')}</div> : !overview ? <div className="flex min-h-96 items-center justify-center text-sm text-muted-foreground">{t('appointments.overview.empty', 'No booking overview data available.')}</div> : (
              <AppointmentResourceTimeline
                date={date}
                resources={overview.resources}
                appointments={overview.appointments}
                blocks={overview.blocks}
                fitScreen={isFitScreen}
                placementMode={Boolean(placementAppointment)}
                placementStartAt={placementAppointment?.requestedStartAt}
                renderAppointmentPopover={(timelineAppointment, block, close, timelineBounds) => {
                  const appointment = appointmentById.get(timelineAppointment.id)
                  return appointment ? <BookingQuickPopover appointment={appointment} anchorBlock={block as Block} blocks={overview.blocks} close={close} onCopy={copyAppointment} onDepositChange={updateDeposit} onDelete={deleteAppointment} onDeleteService={deleteService} onAddService={openAddService} onAssignStaff={openStaffAssignment} onOpenSeatPlanner={openSeatPlanner} onScheduleChange={saveScheduleAssignment} timelineStartMinutes={timelineBounds.startMinutes} timelineEndMinutes={timelineBounds.endMinutes} canCreate={canCreate} canManage={canManage} canViewSeatPlanner={canViewSeatPlanner} /> : null
                }}
                onSlotClick={createBookingSlot || (!canCreate && !placementAppointment) ? undefined : (resourceId, time) => {
                  if (placementAppointment) {
                    const startsAt = new Date(`${date}T${time}:00`).toISOString()
                    void assignUnconfirmedToGrid(resourceId, startsAt)
                    return
                  }
                  const resource = overview.resources.find((entry) => entry.id === resourceId)
                  if (resource) setCreateBookingSlot({ date, time, resourceId, resourceName: resource.name })
                }}
              />
            )}
          </div>
        </div>
      </PageBody>
      <Sheet open={unconfirmedOpen} onOpenChange={setUnconfirmedOpen}>
        <SheetContent side="right" className="w-full overflow-hidden sm:max-w-md">
          <SheetHeader className="border-b px-6 py-5">
            <SheetTitle className="flex items-center gap-2"><Inbox className="size-5 text-status-warning-icon" />{t('appointments.overview.unconfirmed', 'Unconfirmed')}<span className="rounded-full bg-status-warning-bg px-2 py-0.5 text-xs text-status-warning-text">{overview?.unconfirmedAppointmentIds.length ?? 0}</span></SheetTitle>
            <SheetDescription>{t('appointments.overview.unconfirmedHint', 'Bookings that still need schedule confirmation.')}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-3 overflow-y-auto p-5">
            {(overview?.unconfirmedAppointmentIds ?? []).map((appointmentId) => {
              const appointment = appointmentById.get(appointmentId)
              if (!appointment) return null
              const duration = appointment.lines.reduce((total, line) => total + (line.durationMinutes ?? 0), 0)
              const isSelected = placementAppointment?.id === appointment.id
              return (
                <div key={appointment.id} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold">{appointment.customerSalutation ? `${appointment.customerSalutation}. ` : ''}{appointment.customerName}</p>
                      <p className="text-sm text-muted-foreground">{appointment.customerPhoneCountryCode ? `${appointment.customerPhoneCountryCode} ` : ''}{appointment.customerPhone ?? t('appointments.list.noValue')}</p>
                    </div>
                    <span className="shrink-0 rounded-md bg-status-warning-bg px-2 py-1 text-sm font-semibold text-status-warning-text">{displayTime(appointment.requestedStartAt)}</span>
                  </div>
                  <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Clock className="size-4" />{duration} {t('appointments.overview.minutes', 'mins')}</p>
                  <p className="mt-3 rounded-md bg-input-bg px-3 py-2 text-sm text-muted-foreground">{appointment.lines.map((line) => line.productTitle).join(', ')}</p>
                  {canManage ? <Button type="button" className="mt-4 w-full" variant={isSelected ? 'secondary' : 'default'} disabled={isAssigning} onClick={() => isSelected ? setPlacementAppointment(null) : startUnconfirmedPlacement(appointment)}>{isSelected ? t('appointments.overview.cancelAssignment', 'Cancel Assignment') : t('appointments.overview.assignToGrid', 'Assign to Grid')}</Button> : null}
                </div>
              )
            })}
            {(overview?.unconfirmedAppointmentIds.length ?? 0) === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{t('appointments.overview.noUnconfirmed', 'No unconfirmed bookings.')}</p> : null}
          </div>
        </SheetContent>
      </Sheet>
      <BookingOverviewCreateSheet
        open={Boolean(createBookingSlot)}
        onOpenChange={(open) => { if (!open) setCreateBookingSlot(null) }}
        initialState={createBookingSlot}
        organizationId={organizationId}
        onSuccess={() => reload(true)}
        onConflict={(appointmentId) => openSeatPlanner(appointmentId)}
      />
      <AppointmentStaffAssignmentSheet
        target={staffSheetTarget?.target ?? null}
        staff={staffMembers}
        isLoadingStaff={isLoadingStaff}
        isLoadingMoreStaff={isLoadingMoreStaff}
        hasMoreStaff={hasMoreStaff}
        busyStaffIds={busyStaffIds}
        isSaving={isSavingStaff}
        onClose={() => setStaffSheetTarget(null)}
        onAssign={(staffId) => void saveStaffAssignment(staffId)}
        onDurationChange={(duration) => void saveStaffAssignment(staffSheetTarget?.target.assignedMemberId ?? null, duration)}
        onLoadMore={() => void loadStaffPage(staffPageRef.current + 1)}
      />
      <Dialog open={Boolean(serviceDialogAppointment)} onOpenChange={(open) => { if (!open) { setServiceDialogAppointment(null); setSelectedServices([]) } }}>
        <DialogContent size="lg" className="max-h-[90dvh] overflow-hidden" disableBodyWrap>
          <DialogHeader>
            <DialogTitle>{t('appointments.seatPlanner.addServiceTitle', 'Add service')}</DialogTitle>
            <DialogDescription>{t('appointments.seatPlanner.addServiceHint', 'Choose one or more services to add to this booking.')}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5 sm:px-6">
            {serviceLoadError ? <p className="text-sm text-status-error-text">{serviceLoadError}</p> : <AppointmentServicePicker services={bookableServices.filter((service) => !serviceDialogAppointment?.lines.some((line) => line.productId === service.id))} loading={isLoadingServices} emptyLabel={t('appointments.seatPlanner.servicesLoading', 'Loading services...')} value={selectedServices} onChange={setSelectedServices} disabled={isAddingService} />}
          </div>
          <DialogFooter bordered>
            <Button type="button" variant="soft" disabled={isAddingService} onClick={() => setServiceDialogAppointment(null)}>{t('common.cancel', 'Cancel')}</Button>
            <Button type="button" disabled={isAddingService || isLoadingServices || selectedServices.length === 0} onClick={() => void addServices()}><Plus className="size-4" />{isAddingService ? t('appointments.seatPlanner.addingService', 'Adding...') : t('appointments.overview.addService', 'Add service')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
