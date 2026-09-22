"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarCheck, Check, ListFilter, Settings, Eye, Edit, Copy, LayoutPanelTop, Trash2 } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { useOrganizationScopeDetail, useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildHrefWithReturnTo } from '@open-mercato/shared/lib/navigation/returnTo'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { AppointmentContactCell } from '../../components/AppointmentContactCell'
import { AppointmentNotesCell } from '../../components/AppointmentNotesCell'
import { AppointmentStatusSelect } from '../../components/AppointmentStatusSelect'
import { AppointmentUrgencyCell } from '../../components/AppointmentUrgencyCell'
import { AppointmentArrivalInfo } from '../../components/AppointmentArrivalInfo'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { AppointmentStatusBadge } from '../../components/AppointmentStatusBadge'
import { APPOINTMENT_BOOKING_TYPE_OPTIONS } from '../../data/constants'
import { formatCustomerDisplayName } from '../../lib/customerName'
import { getAppointmentPermissionSet } from '../../lib/permissions'

type Row = {
  id: string
  organizationId: string
  organizationName: string | null
  customerName: string
  customerSalutation: string | null
  customerPhone: string | null
  customerEmail: string | null
  customerPhoneCountryCode: string | null
  bookingType: string | null
  statusCode: string
  requestedStartAt: string
  notes: string | null
  externalNotes: string | null
  createdAt: string
  updatedAt: string
  totalAmount: number | null
  currencyCode: string | null
  scheduleConfirmationStatus: 'confirmed' | 'unconfirmed' | 'not_applicable'
}

type ListPayload = { items: Row[]; total?: number; totalPages?: number }

type StatusOption = { code: string; label: string }

const APPOINTMENTS_SYNC_INTERVAL_MS = 5_000

function parseRequestedAt(value: string): Date | null {
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return date
  } catch {
    return null
  }
}

function formatBookingDate(value: string, emptyLabel: string) {
  const date = parseRequestedAt(value)
  if (!date) return emptyLabel
  return date.toLocaleDateString()
}

function formatBookingTime(value: string, emptyLabel: string) {
  const date = parseRequestedAt(value)
  if (!date) return emptyLabel
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatBookingType(value: string | null | undefined, emptyLabel: string) {
  if (!value) return emptyLabel
  const label = APPOINTMENT_BOOKING_TYPE_OPTIONS.find((option) => option.value === value)?.label
  return label ?? value
}

function formatTotal(amount: number | null, currencyCode: string | null, emptyLabel: string) {
  if (amount === null || !Number.isFinite(amount)) return emptyLabel
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode || 'VND',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${amount.toLocaleString()} ${currencyCode ?? ''}`.trim()
  }
}

function ScheduleBadge({ status, t }: { status: Row['scheduleConfirmationStatus']; t: ReturnType<typeof useT> }) {
  const isConfirmed = status === 'confirmed'
  const isUnconfirmed = status === 'unconfirmed'
  if (!isConfirmed && !isUnconfirmed) {
    return <StatusBadge variant="neutral">{t('appointments.list.schedule.notApplicable', 'Not tracked')}</StatusBadge>
  }
  return (
    <StatusBadge variant={isConfirmed ? 'success' : 'warning'} dot>
      <span className="inline-flex items-center gap-1">
        <CalendarCheck className="size-3.5" />
        {isConfirmed
          ? t('appointments.list.schedule.confirmed', 'Confirmed')
          : t('appointments.list.schedule.unconfirmed', 'Unconfirmed')}
      </span>
    </StatusBadge>
  )
}

function StatusFilterButton({
  options,
  selectedCodes,
  onChange,
  t,
}: {
  options: StatusOption[]
  selectedCodes: Set<string>
  onChange: (codes: string[]) => void
  t: ReturnType<typeof useT>
}) {
  const [open, setOpen] = React.useState(false)
  const [localSelectedCodes, setLocalSelectedCodes] = React.useState(() => new Set(selectedCodes))
  const preserveTableScroll = React.useCallback((update: () => void) => {
    const scrollport = document.querySelector<HTMLElement>('[data-table-scrollport]')
    const scrollLeft = scrollport?.scrollLeft
    update()
    if (!scrollport || scrollLeft === undefined) return
    window.requestAnimationFrame(() => {
      scrollport.scrollLeft = scrollLeft
      window.requestAnimationFrame(() => {
        scrollport.scrollLeft = scrollLeft
      })
    })
  }, [])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="gap-2 border-dashed"
          aria-label={t('appointments.list.filters.status', 'Status')}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <ListFilter className="size-4" />
          {t('appointments.list.filters.status', 'Status')}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="z-popover max-h-96 w-72 overflow-y-auto p-2">
        {options.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">{t('appointments.list.filters.noStatuses', 'No statuses available')}</p> : options.map((option) => {
          const checked = localSelectedCodes.has(option.code)
          return (
            <button
              key={option.code}
              type="button"
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                const next = new Set(localSelectedCodes)
                if (checked) next.delete(option.code)
                else next.add(option.code)
                preserveTableScroll(() => {
                  setLocalSelectedCodes(next)
                  onChange(Array.from(next))
                })
              }}
            >
              <span className="flex size-5 items-center justify-center rounded border border-input">
                {checked ? <Check className="size-4 text-primary" /> : null}
              </span>
              <AppointmentStatusBadge statusCode={option.code} label={option.label} dot={false} />
            </button>
          )
        })}
        {localSelectedCodes.size > 0 ? <Button type="button" variant="ghost" size="sm" className="mt-1 w-full" onClick={() => preserveTableScroll(() => { setLocalSelectedCodes(new Set()); onChange([]) })}>{t('appointments.list.filters.clearStatus', 'Clear status')}</Button> : null}
      </PopoverContent>
    </Popover>
  )
}

export default function AppointmentsListPage() {
  const t = useT()
  const pathname = usePathname()
  const { payload: backendChromePayload, isReady: backendChromeReady } = useBackendChrome()
  const { canCreate, canManage, canManageSettings, canViewSeatPlanner } = getAppointmentPermissionSet(
    backendChromePayload?.grantedFeatures,
    backendChromeReady,
  )
  const scopeVersion = useOrganizationScopeVersion()
  const { tenantId: scopeTenantId } = useOrganizationScopeDetail()
  const [rows, setRows] = React.useState<Row[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [selectedStatusCodes, setSelectedStatusCodes] = React.useState<Set<string>>(() => new Set())
  const [reloadToken, setReloadToken] = React.useState(0)
  const [statusOptions, setStatusOptions] = React.useState<{ code: string; label: string }[]>([])
  const hasLoadedAppointmentsRef = React.useRef(false)

  useAppEvent('appointments.appointment.*', () => {
    setReloadToken((value) => value + 1)
  }, [])

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      setReloadToken((value) => value + 1)
    }, APPOINTMENTS_SYNC_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [])

  const prepareSeatPlannerScope = React.useCallback((organizationId: string) => {
    const normalizedOrganizationId = organizationId.trim()
    if (!normalizedOrganizationId || typeof document === 'undefined') return

    document.cookie = `om_selected_org=${encodeURIComponent(normalizedOrganizationId)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`
    emitOrganizationScopeChanged({ organizationId: normalizedOrganizationId, tenantId: scopeTenantId ?? null })
  }, [scopeTenantId])

  const statusesSettingsHref = React.useMemo(
    () => buildHrefWithReturnTo('/backend/config/appointments', pathname || '/backend/appointments'),
    [pathname],
  )

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function loadStatuses() {
      try {
        const call = await apiCall<{ items?: StatusOption[] }>(
          '/api/appointments/statuses',
          { signal: controller.signal },
          { fallback: { items: [] } },
        )
        if (cancelled || !call.ok) return
        setStatusOptions(
          (call.result?.items ?? []).map((item) => ({
            code: item.code,
            label: item.label,
          })),
        )
      } catch {
        if (cancelled || controller.signal.aborted) return
      }
    }
    void loadStatuses()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [scopeVersion])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    })
    if (search.trim()) params.set('search', search.trim())
    if (selectedStatusCodes.size > 0) {
      params.set('statusCode', Array.from(selectedStatusCodes).join(','))
    }
    return params.toString()
  }, [page, pageSize, search, selectedStatusCodes])

  const filters = React.useMemo<FilterDef[]>(
    () => [],
    [],
  )

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function load() {
      if (!hasLoadedAppointmentsRef.current) setIsLoading(true)
      try {
        const call = await apiCall<ListPayload>(
          `/api/appointments?${queryParams}`,
          { signal: controller.signal },
          { fallback: { items: [] } },
        )
        if (!call.ok) {
          if (cancelled) return
          const errorPayload = call.result as { error?: string } | undefined
          flash(
            typeof errorPayload?.error === 'string'
              ? errorPayload.error
              : t('appointments.list.error.loadFailed'),
            'error',
          )
          return
        }
        if (!cancelled) {
          setRows(Array.isArray(call.result?.items) ? call.result.items : [])
          setTotal(typeof call.result?.total === 'number' ? call.result.total : 0)
          setTotalPages(typeof call.result?.totalPages === 'number' ? call.result.totalPages : 1)
          hasLoadedAppointmentsRef.current = true
        }
      } catch (error) {
        if (!cancelled) {
          flash(
            error instanceof Error ? error.message : t('appointments.list.error.loadFailed'),
            'error',
          )
        }
      } finally {
        if (!cancelled) {
          hasLoadedAppointmentsRef.current = true
          setIsLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [queryParams, reloadToken, scopeVersion, t])

  const { ConfirmDialogElement, confirm } = useConfirmDialog()

  const handleRowStatusChange = React.useCallback((appointmentId: string, nextStatusCode: string) => {
    setRows((current) =>
      current.map((row) =>
        row.id === appointmentId ? { ...row, statusCode: nextStatusCode } : row,
      ),
    )
  }, [])

  const handleClone = React.useCallback(async (row: Row) => {
    try {
      const call = await apiCall<{ success: boolean; id?: string; error?: string }>(
        `/api/appointments/${row.id}/clone`,
        { method: 'POST' },
        { fallback: { success: false } }
      )
      if (!call.ok || call.result?.error) {
        throw new Error(call.result?.error || t('appointments.clone.failed', 'Unable to clone appointment.'))
      }
      flash(t('appointments.clone.success', 'Appointment cloned successfully'), 'success')
      setReloadToken((prev: number) => prev + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('appointments.clone.failed', 'Unable to clone appointment.')
      flash(message, 'error')
    }
  }, [t])

  const handleDelete = React.useCallback(async (row: Row) => {
    const confirmed = await confirm({
      title: t('appointments.list.actions.deleteConfirm', 'Delete this appointment?'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      const headers = buildOptimisticLockHeader(row.updatedAt)
      const call = await apiCall<{ success: boolean; error?: string }>(
        `/api/appointments/${row.id}`,
        { method: 'DELETE', headers },
        { fallback: { success: false } }
      )
      if (!call.ok || call.result?.error) {
        throw new Error(call.result?.error || t('appointments.delete.failed', 'Unable to delete appointment.'))
      }
      flash(t('appointments.delete.success', 'Appointment deleted'), 'success')
      setRows((current) => current.filter((r) => r.id !== row.id))
      setTotal((current) => Math.max(0, current - 1))
      setReloadToken((current) => current + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('appointments.delete.failed', 'Unable to delete appointment.')
      flash(message, 'error')
    }
  }, [confirm, t])

  const currentPage = totalPages === 0 ? 1 : Math.min(page, totalPages)

  React.useEffect(() => {
    if (page !== currentPage) setPage(currentPage)
  }, [currentPage, page])

  const columns = React.useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: 'urgency',
        accessorKey: 'createdAt',
        header: () => (
          <div className="text-center">{t('appointments.list.columns.urgency', 'Urgency')}</div>
        ),
        size: 140,
        cell: ({ row }) => (
          <div className="flex justify-center">
              <AppointmentUrgencyCell
                createdAt={row.original.createdAt}
                statusCode={row.original.statusCode}
                isPinned={row.original.scheduleConfirmationStatus === 'unconfirmed'}
              />
          </div>
        ),
      },
      {
        id: 'total',
        accessorKey: 'totalAmount',
        header: t('appointments.list.columns.total', 'Total'),
        cell: ({ row }) => formatTotal(row.original.totalAmount, row.original.currencyCode, t('appointments.list.noValue')),
      },
      {
        id: 'bookingDate',
        accessorKey: 'requestedStartAt',
        header: t('appointments.list.columns.bookingDate', 'Booking Date'),
        cell: ({ row }) =>
          formatBookingDate(row.original.requestedStartAt, t('appointments.list.noValue')),
      },
      {
        id: 'bookingTime',
        accessorKey: 'requestedStartAt',
        header: t('appointments.list.columns.time', 'Time'),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">
              {formatBookingTime(row.original.requestedStartAt, t('appointments.list.noValue'))}
            </span>
            <AppointmentArrivalInfo
              requestedStartAt={row.original.requestedStartAt}
              statusCode={row.original.statusCode}
            />
          </div>
        ),
      },
      {
        id: 'customerName',
        accessorFn: (row) =>
          formatCustomerDisplayName(row.customerSalutation, row.customerName),
        header: t('appointments.list.columns.customerName', 'Customer Name'),
        cell: ({ row }) => (
          <span className="truncate font-medium">
            {formatCustomerDisplayName(
              row.original.customerSalutation,
              row.original.customerName,
            ) || t('appointments.list.noValue')}
          </span>
        ),
      },
      {
        id: 'contact',
        accessorFn: (row) =>
          `${row.customerPhoneCountryCode ?? ''} ${row.customerPhone ?? ''} ${row.customerEmail ?? ''}`.trim(),
        header: t('appointments.list.columns.contact', 'Contact'),
        meta: { truncate: false },
        cell: ({ row }) => (
          <AppointmentContactCell
            phoneCountryCode={row.original.customerPhoneCountryCode}
            customerPhone={row.original.customerPhone}
            customerEmail={row.original.customerEmail}
          />
        ),
      },
      {
        id: 'organizationName',
        accessorKey: 'organizationName',
        header: t('appointments.list.columns.location', 'Location'),
        cell: ({ row }) =>
          row.original.organizationName?.trim() || t('appointments.list.noValue'),
      },
      {
        id: 'bookingType',
        accessorKey: 'bookingType',
        header: t('appointments.list.columns.bookingType', 'Type of booking'),
        cell: ({ row }) => formatBookingType(row.original.bookingType, t('appointments.list.noValue')),
      },
      {
        id: 'externalNotes',
        accessorKey: 'externalNotes',
        header: t('appointments.list.columns.customerNotes', 'Customer Notes'),
        meta: { truncate: false },
        cell: ({ row }) => (
          <AppointmentNotesCell
            notes={row.original.externalNotes}
            titleKey="appointments.list.notes.customerTitle"
            titleFallback="Customer Notes"
          />
        ),
      },
      {
        id: 'notes',
        accessorKey: 'notes',
        header: t('appointments.list.columns.internalNotes', 'Internal Notes'),
        meta: { truncate: false },
        cell: ({ row }) => (
          <AppointmentNotesCell
            notes={row.original.notes}
            titleKey="appointments.list.notes.internalTitle"
            titleFallback="Internal Notes"
          />
        ),
      },
      {
        id: 'schedule',
        accessorKey: 'statusCode',
        header: t('appointments.list.columns.schedule', 'Schedule'),
        meta: { truncate: false },
        cell: ({ row }) => <ScheduleBadge status={row.original.scheduleConfirmationStatus} t={t} />,
      },
      {
        id: 'statusCode',
        accessorKey: 'statusCode',
        header: () => (
          <StatusFilterButton
            options={statusOptions}
            selectedCodes={selectedStatusCodes}
            onChange={(codes) => {
              setSelectedStatusCodes(new Set(codes))
              setPage(1)
            }}
            t={t}
          />
        ),
        meta: { truncate: false },
        cell: ({ row }) => (
          <AppointmentStatusSelect
            appointmentId={row.original.id}
            statusCode={row.original.statusCode}
            statuses={statusOptions}
            disabled={!canManage}
            onStatusChange={(nextCode) => handleRowStatusChange(row.original.id, nextCode)}
          />
        ),
      },
      {
        id: 'actions',
        header: () => <div className="text-center">{t('appointments.list.columns.actions', 'Actions')}</div>,
        meta: { truncate: false },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1.5">
            <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs" title={t('appointments.list.actions.view', 'View Details')}>
              <Link href={`/backend/appointments/${row.original.id}`}>
                <Eye className="h-3.5 w-3.5" />
              </Link>
            </Button>
            {canManage ? (
              <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs" title={t('appointments.list.actions.edit', 'Edit Booking')}>
                <Link href={`/backend/appointments/${row.original.id}/edit`}>
                  <Edit className="h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : null}
            {canCreate ? (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" title={t('appointments.list.actions.clone', 'Clone Booking')} onClick={() => void handleClone(row.original)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            ) : null}
            {canViewSeatPlanner ? (
              <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs" title={t('appointments.list.actions.planner', 'Open Seat Planner')}>
                <Link
                  href={`/backend/appointments/${row.original.id}/seat-planner`}
                  onClick={() => prepareSeatPlannerScope(row.original.organizationId)}
                >
                  <LayoutPanelTop className="h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : null}
            {canManage ? (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive" title={t('appointments.list.actions.delete', 'Delete Booking')} onClick={() => void handleDelete(row.original)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [canCreate, canManage, canViewSeatPlanner, handleClone, handleDelete, handleRowStatusChange, prepareSeatPlannerScope, selectedStatusCodes, statusOptions, t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('appointments.list.title')}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline">
                <Link href="/backend/appointments/booking-overview">
                  {t('appointments.list.actions.overview', 'Booking Overview')}
                </Link>
              </Button>
              {canManageSettings ? (
                <Button asChild variant="outline">
                  <Link href={statusesSettingsHref}>
                    <Settings className="size-4" aria-hidden="true" />
                    {t('appointments.list.actions.configureStatuses', 'Configure statuses')}
                  </Link>
                </Button>
              ) : null}
              {canCreate ? (
                <Button asChild>
                  <Link href="/backend/appointments/create">
                    {t('appointments.list.actions.create')}
                  </Link>
                </Button>
              ) : null}
            </div>
          }
          columns={columns}
          data={rows}
          pagination={{
            page: currentPage,
            pageSize,
            total,
            totalPages,
            onPageChange: setPage,
            pageSizeOptions: [10, 25, 50, 100],
            onPageSizeChange: (nextPageSize) => {
              setPageSize(nextPageSize)
              setPage(1)
            },
          }}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => setFilterValues(values)}
          onFiltersClear={() => setFilterValues({})}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('appointments.list.search.placeholder', 'Search bookings…')}
          isLoading={isLoading}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
