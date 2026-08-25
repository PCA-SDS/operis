"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type Row = {
  id: string
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  statusCode: string
  requestedStartAt: string
  notes: string | null
}

type ListPayload = { items: Row[] }

type StatusOption = { code: string; label: string }

function formatDateTime(value: string, emptyLabel: string) {
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return emptyLabel
    return date.toLocaleString()
  } catch {
    return emptyLabel
  }
}

export default function AppointmentsListPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<Row[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [statusOptions, setStatusOptions] = React.useState<{ value: string; label: string }[]>([])

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
          value: item.code,
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
        options: statusOptions,
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

  const columns = React.useMemo<ColumnDef<Row>[]>(
    () => [
      {
        accessorKey: 'customerName',
        header: t('appointments.list.columns.customer'),
      },
      {
        accessorKey: 'customerPhone',
        header: t('appointments.list.columns.phone'),
        cell: ({ row }) => row.original.customerPhone || t('appointments.list.noValue'),
      },
      {
        accessorKey: 'customerEmail',
        header: t('appointments.list.columns.email'),
        cell: ({ row }) => row.original.customerEmail || t('appointments.list.noValue'),
      },
      {
        accessorKey: 'statusCode',
        header: t('appointments.list.columns.status'),
      },
      {
        accessorKey: 'requestedStartAt',
        header: t('appointments.list.columns.requestedStart'),
        cell: ({ row }) =>
          formatDateTime(row.original.requestedStartAt, t('appointments.list.noValue')),
      },
      {
        accessorKey: 'notes',
        header: t('appointments.list.columns.notes'),
        cell: ({ row }) => row.original.notes || t('appointments.list.noValue'),
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('appointments.list.title')}
          actions={
            <Button asChild>
              <Link href="/backend/appointments/create">
                {t('appointments.list.actions.create')}
              </Link>
            </Button>
          }
          columns={columns}
          data={rows}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => setFilterValues(values)}
          onFiltersClear={() => setFilterValues({})}
          perspective={{ tableId: 'appointments.list' }}
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
