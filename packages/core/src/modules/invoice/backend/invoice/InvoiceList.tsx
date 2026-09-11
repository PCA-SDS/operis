'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type InvoiceRow = { id: string; direction: 'AP' | 'AR'; partnerName: string | null; invoiceNumber: string | null; invoiceDate: string | null; dueDate: string | null; currencyCode: string | null; grossAmount: string | null; outstandingAmount: string | null; settlementStatus: string | null; origin: string | null }
type Response = { items: InvoiceRow[]; total: number; page: number; pageSize: number; totalPages: number }

export function InvoiceList({ direction }: { direction?: 'AP' | 'AR' }) {
  const t = useT(); const router = useRouter(); const searchParams = useSearchParams()
  const [payload, setPayload] = React.useState<Response | null>(null); const [loading, setLoading] = React.useState(true); const [failed, setFailed] = React.useState(false)
  const page = Number(searchParams.get('page') ?? '1') || 1; const search = searchParams.get('search') ?? ''
  const load = React.useCallback(async () => { setLoading(true); setFailed(false); const params = new URLSearchParams({ page: String(page), pageSize: '50', sortField: searchParams.get('sortField') ?? 'invoiceDate', sortDir: searchParams.get('sortDir') ?? 'desc' }); if (direction) params.set('direction', direction); if (search) params.set('search', search); const call = await apiCall<Response>(`/api/invoice/invoices?${params}`); if (!call.ok || !call.result) setFailed(true); else setPayload(call.result); setLoading(false) }, [direction, page, search, searchParams])
  React.useEffect(() => { void load() }, [load])
  const columns = React.useMemo<ColumnDef<InvoiceRow>[]>(() => [
    { accessorKey: 'invoiceNumber', header: t('invoice.list.columns.number') },
    { accessorKey: 'direction', header: t('invoice.list.columns.direction') },
    { accessorKey: 'partnerName', header: t('invoice.list.columns.partner') },
    { accessorKey: 'invoiceDate', header: t('invoice.list.columns.issueDate'), cell: ({ row }) => row.original.invoiceDate ? new Date(row.original.invoiceDate).toLocaleDateString() : '—' },
    { accessorKey: 'dueDate', header: t('invoice.list.columns.dueDate'), cell: ({ row }) => row.original.dueDate ? new Date(row.original.dueDate).toLocaleDateString() : '—' },
    { accessorKey: 'grossAmount', header: t('invoice.list.columns.total'), cell: ({ row }) => row.original.grossAmount ? `${row.original.grossAmount} ${row.original.currencyCode ?? ''}` : '—' },
    { accessorKey: 'outstandingAmount', header: t('invoice.list.columns.outstanding'), cell: ({ row }) => row.original.outstandingAmount ? `${row.original.outstandingAmount} ${row.original.currencyCode ?? ''}` : '—' },
    { accessorKey: 'settlementStatus', header: t('invoice.list.columns.settlement') },
    { accessorKey: 'origin', header: t('invoice.list.columns.origin') },
  ], [t])
  if (loading && !payload) return <Page><PageBody><LoadingMessage label={t('invoice.list.loading')} /></PageBody></Page>
  if (failed && !payload) return <Page><PageBody><ErrorMessage label={t('invoice.list.error')} action={<Button type="button" onClick={() => void load()}>{t('invoice.actions.retry')}</Button>} /></PageBody></Page>
  const rows = payload?.items ?? []
  const sorting: SortingState = searchParams.get('sortField') ? [{ id: searchParams.get('sortField')!, desc: searchParams.get('sortDir') === 'desc' }] : []
  return <Page><PageBody><DataTable<InvoiceRow> title={t(direction === 'AP' ? 'invoice.list.payables' : direction === 'AR' ? 'invoice.list.receivables' : 'invoice.list.all')} columns={columns} data={rows} searchValue={search} onSearchChange={(value) => { const params = new URLSearchParams(searchParams.toString()); value ? params.set('search', value) : params.delete('search'); params.delete('page'); router.push(`?${params}`) }} searchPlaceholder={t('invoice.list.search')} onRowClick={(row) => router.push(`/backend/invoice/all/${row.id}`)} sortable manualSorting sorting={sorting} onSortingChange={(current) => { const params = new URLSearchParams(searchParams.toString()); if (current[0]) { params.set('sortField', current[0].id); params.set('sortDir', current[0].desc ? 'desc' : 'asc') } router.push(`?${params}`) }} pagination={{ page: payload?.page ?? page, pageSize: payload?.pageSize ?? 50, total: payload?.total ?? 0, totalPages: payload?.totalPages ?? 0, onPageChange: (next) => { const params = new URLSearchParams(searchParams.toString()); params.set('page', String(next)); router.push(`?${params}`) } }} emptyState={<ListEmptyState entityName={t('invoice.list.all')} />} isLoading={loading} /></PageBody></Page>
}
