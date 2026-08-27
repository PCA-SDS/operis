"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Settings } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildHrefWithReturnTo } from '@open-mercato/shared/lib/navigation/returnTo'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { AppointmentContactCell } from '../../components/AppointmentContactCell'
import { AppointmentNotesCell } from '../../components/AppointmentNotesCell'
import { AppointmentStatusSelect } from '../../components/AppointmentStatusSelect'
import { AppointmentUrgencyCell } from '../../components/AppointmentUrgencyCell'
import { AppointmentArrivalInfo } from '../../components/AppointmentArrivalInfo'
import { formatCustomerDisplayName } from '../../lib/customerName'
import { formatCustomerPhone } from '../../lib/phoneSnapshot'

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
}

type ListPayload = { items: Row[] }

type StatusOption = { code: string; label: string }

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

function matchesSearch(row: Row, query: string, statusLabel: string | undefined): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const haystack = [
    formatCustomerDisplayName(row.customerSalutation, row.customerName),
    row.customerName,
    row.organizationName ?? '',
    row.customerEmail ?? '',
    formatCustomerPhone(row.customerPhoneCountryCode, row.customerPhone),
    row.customerPhone ?? '',
    row.bookingType ?? '',
    row.statusCode,
    statusLabel ?? '',
    row.notes ?? '',
    row.externalNotes ?? '',
    row.id,
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}

export default function AppointmentsListPage() {
  const t = useT()
  const pathname = usePathname()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<Row[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [statusOptions, setStatusOptions] = React.useState<{ code: string; label: string }[]>([])

  const statusesSettingsHref = React.useMemo(
    () => buildHrefWithReturnTo('/backend/config/appointments', pathname || '/backend/appointments'),
    [pathname],
  )

  React.useEffect(() => {
    let cancelled = false
    async function loadStatuses() {
      const call = await apiCall<{ items?: StatusOption[] }>(
        '/api/appointments/statuses',
        undefined,
        { fallback: { items: [] } },
      )
      if (cancelled || !call.ok) return
      setStatusOptions(
        (call.result?.items ?? []).map((item) => ({
          code: item.code,
          label: item.label,
        })),
      )
    }
    void loadStatuses()
    return () => {
      cancelled = true
    }
  }, [scopeVersion])

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'statusCode',
        label: t('appointments.list.filters.status'),
        type: 'select',
        options: statusOptions.map((option) => ({
          value: option.code,
          label: option.label,
        })),
      },
    ],
    [t, statusOptions],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        const statusCode =
          typeof filterValues.statusCode === 'string' ? filterValues.statusCode.trim() : ''
        if (statusCode) params.set('statusCode', statusCode)
        const qs = params.toString()
        const call = await apiCall<ListPayload>(
          `/api/appointments${qs ? `?${qs}` : ''}`,
          undefined,
          { fallback: { items: [] } },
        )
        if (!call.ok) {
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
        }
      } catch (error) {
        if (!cancelled) {
          flash(
            error instanceof Error ? error.message : t('appointments.list.error.loadFailed'),
            'error',
          )
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [filterValues, scopeVersion, t])

  const handleRowStatusChange = React.useCallback((appointmentId: string, nextStatusCode: string) => {
    setRows((current) =>
      current.map((row) =>
        row.id === appointmentId ? { ...row, statusCode: nextStatusCode } : row,
      ),
    )
  }, [])

  const statusLabelByCode = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const option of statusOptions) {
      map.set(option.code, option.label)
    }
    return map
  }, [statusOptions])

  const visibleRows = React.useMemo(
    () =>
      rows.filter((row) => matchesSearch(row, search, statusLabelByCode.get(row.statusCode))),
    [rows, search, statusLabelByCode],
  )

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
        id: 'organizationName',
        accessorKey: 'organizationName',
        header: t('appointments.list.columns.location', 'Location'),
        cell: ({ row }) =>
          row.original.organizationName?.trim() || t('appointments.list.noValue'),
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
        id: 'statusCode',
        accessorKey: 'statusCode',
        header: t('appointments.list.columns.status'),
        meta: { truncate: false },
        cell: ({ row }) => (
          <AppointmentStatusSelect
            appointmentId={row.original.id}
            statusCode={row.original.statusCode}
            statuses={statusOptions}
            onStatusChange={(nextCode) => handleRowStatusChange(row.original.id, nextCode)}
          />
        ),
      },
    ],
    [t, statusOptions, handleRowStatusChange],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('appointments.list.title')}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline">
                <Link href={statusesSettingsHref}>
                  <Settings className="size-4" aria-hidden="true" />
                  {t('appointments.list.actions.configureStatuses', 'Configure statuses')}
                </Link>
              </Button>
              <Button asChild>
                <Link href="/backend/appointments/create">
                  {t('appointments.list.actions.create')}
                </Link>
              </Button>
            </div>
          }
          columns={columns}
          data={visibleRows}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => setFilterValues(values)}
          onFiltersClear={() => setFilterValues({})}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('appointments.list.search.placeholder', 'Search appointments…')}
          perspective={{ tableId: 'appointments.list.v5' }}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'view',
                  label: t('appointments.list.actions.view'),
                  href: `/backend/appointments/${row.id}`,
                },
              ]}
            />
          )}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
