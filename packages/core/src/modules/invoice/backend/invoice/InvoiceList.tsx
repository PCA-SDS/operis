'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Ban, CalendarDays, Pencil, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Dropdown } from '@open-mercato/ui/primitives/dropdown'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useInvoiceT as useT } from '../../lib/useInvoiceT'
import { InvoiceSyncButton } from './components/InvoiceSyncButton'
import { IssuedDateFilter } from './components/IssuedDateFilter'
import { InstallmentsDialog } from './components/InstallmentsDialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { formatInvoiceMoney } from '../../lib/format'

type InvoiceRow = { id: string; direction: 'AP' | 'AR'; companyId: string | null; partnerName: string | null; invoiceSymbol: string | null; invoiceNumber: string | null; invoiceDate: string | null; dueDate: string | null; nextDueDate: string | null; currencyCode: string | null; grossAmount: string | null; settlementStatus: string | null; invoiceStatus: string | null; hasInstallmentPlan: boolean; hasReceived: boolean; hasPaid: boolean; autoSettled: boolean; nonRecoverable: boolean; lastSentAt: string | null; origin: string | null; updatedAt: string | null }
type Response = { items: InvoiceRow[]; total: number; page: number; pageSize: number; totalPages: number }
type DirectionSummary = { outstandingAmount: string; settledAmount: string; unpaidInvoices: number; partiallyPaidInvoices: number; paidInvoices: number; unreceivedInvoices: number; receivedInvoices: number; nonRecoverableInvoices: number }
type SummaryResponse = { currency: 'VND'; ar: DirectionSummary; ap: DirectionSummary }

type FilterOption = { value: string; label: string }

function InvoiceFilter({ value, options, onChange, ariaLabel }: { value: string; options: FilterOption[]; onChange: (value: string) => void; ariaLabel: string }) {
  const selected = options.find((option) => option.value === value)
  const triggerClassName = value === 'all'
    ? '!border-border !text-foreground shadow-sm hover:!bg-surface-muted'
    : 'shadow-sm'
  return <Dropdown value={value} options={options} onChange={(next) => onChange(next ?? 'all')} placeholder={selected?.label ?? options[0]?.label ?? ''} triggerLabel={selected?.label ?? options[0]?.label} ariaLabel={ariaLabel} triggerLeading={false} variant="filter" size="default" triggerClassName={triggerClassName} />
}

export function InvoiceList({ direction, showSyncButton = false, mobileFit = false }: { direction?: 'AP' | 'AR'; showSyncButton?: boolean; mobileFit?: boolean }) {
  const t = useT(); const router = useRouter(); const searchParams = useSearchParams()
  const [payload, setPayload] = React.useState<Response | null>(null); const [loading, setLoading] = React.useState(true); const [failed, setFailed] = React.useState(false)
  const [summary, setSummary] = React.useState<SummaryResponse | null>(null)
  const { runMutation } = useGuardedMutation({ contextId: 'invoice.list' })
  const installmentsId = searchParams.get('installmentsId')
  const closeInstallments = () => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('installmentsId')
    router.push(`?${params}`)
  }
  const [deletingInvoiceId, setDeletingInvoiceId] = React.useState<string | null>(null)
  const [updatingInvoiceId, setUpdatingInvoiceId] = React.useState<string | null>(null)
  const page = Number(searchParams.get('page') ?? '1') || 1; const search = searchParams.get('search') ?? ''
  const recoverability = searchParams.get('recoverability') ?? 'all'
  const fromDate = searchParams.get('fromDate') ?? ''
  const toDate = searchParams.get('toDate') ?? ''
  const activeDirection = direction ?? searchParams.get('direction') ?? 'all'
  const setFilter = React.useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') params.delete(key)
    else params.set(key, value)
    params.delete('page')
    router.push(`?${params}`)
  }, [router, searchParams])
  const setIssuedDates = React.useCallback((nextFrom: string, nextTo: string) => {
    const params = new URLSearchParams(searchParams.toString())
    nextFrom ? params.set('fromDate', nextFrom) : params.delete('fromDate')
    nextTo ? params.set('toDate', nextTo) : params.delete('toDate')
    params.delete('page')
    router.push(`?${params}`)
  }, [router, searchParams])
  const openInstallments = React.useCallback(async (invoiceId: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('installmentsId', invoiceId)
    router.push(`?${params}`)
  }, [router, searchParams])
  const load = React.useCallback(async () => { setLoading(true); setFailed(false); const params = new URLSearchParams({ page: String(page), pageSize: '50', sortField: searchParams.get('sortField') ?? 'invoiceDate', sortDir: searchParams.get('sortDir') ?? 'desc' }); if (activeDirection !== 'all') params.set('direction', activeDirection); if (recoverability !== 'all') params.set('recoverability', recoverability); if (fromDate) params.set('fromDate', fromDate); if (toDate) params.set('toDate', toDate); if (search) params.set('search', search); const [call, summaryCall] = await Promise.all([apiCall<Response>(`/api/invoice/invoices?${params}`), direction ? apiCall<SummaryResponse>('/api/invoice/summary') : Promise.resolve(null)]); if (!call.ok || !call.result) setFailed(true); else setPayload(call.result); if (summaryCall?.ok && summaryCall.result) setSummary(summaryCall.result); setLoading(false) }, [activeDirection, direction, fromDate, page, recoverability, search, searchParams, toDate])
  const deleteInvoice = React.useCallback(async () => {
    if (!deletingInvoiceId) return
    const invoice = payload?.items.find((item) => item.id === deletingInvoiceId)
    const call = await runMutation({ context: { invoiceId: deletingInvoiceId }, mutationPayload: { id: deletingInvoiceId }, operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(invoice?.updatedAt), () => apiCall(`/api/invoice/invoices/${deletingInvoiceId}`, { method: 'DELETE' })) })
    if (call.ok) { setDeletingInvoiceId(null); void load() }
    else flash(t('invoice.errors.request_failed'), 'error')
  }, [deletingInvoiceId, load, payload, runMutation, t])
  const updateSettlement = React.useCallback(async (invoice: InvoiceRow, settled: boolean) => {
    if (direction === 'AP') {
      router.push(`/backend/invoice/all/${invoice.id}`)
      return
    }
    setUpdatingInvoiceId(invoice.id)
    const result = await runMutation({ context: { invoiceId: invoice.id }, mutationPayload: { settled }, operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(invoice.updatedAt), () => apiCall(`/api/invoice/invoices/${invoice.id}/settlement`, { method: 'PATCH', body: JSON.stringify({ settled }) })) })
    if (!result.ok) flash(t('invoice.errors.request_failed'), 'error')
    setUpdatingInvoiceId(null)
    void load()
  }, [direction, load, router, runMutation, t])
  const updateRecoverability = React.useCallback(async (invoice: InvoiceRow) => {
    setUpdatingInvoiceId(invoice.id)
    const body = { nonRecoverable: !invoice.nonRecoverable, note: !invoice.nonRecoverable ? t('invoice.actions.writeOffNote') : null }
    const result = await runMutation({ context: { invoiceId: invoice.id }, mutationPayload: body, operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(invoice.updatedAt), () => apiCall(`/api/invoice/invoices/${invoice.id}/non-recoverable`, { method: 'PATCH', body: JSON.stringify(body) })) })
    if (!result.ok) flash(t('invoice.errors.request_failed'), 'error')
    setUpdatingInvoiceId(null)
    void load()
  }, [load, runMutation, t])
  React.useEffect(() => { void load() }, [load])
  const columns = React.useMemo<ColumnDef<InvoiceRow>[]>(() => {
    const dateLabel = (value: string | null) => value ? new Date(value).toLocaleDateString() : '—'
    const paymentStatus = (value: string | null) => {
      if (!value) return '—'
      const due = new Date(value); const today = new Date(); due.setHours(0, 0, 0, 0); today.setHours(0, 0, 0, 0)
      if (Number.isNaN(due.getTime())) return '—'
      if (due.getTime() === today.getTime()) return t('invoice.list.paymentStatus.dueToday', 'Due Today')
      return due < today ? t('invoice.list.paymentStatus.overdue', 'Overdue') : t('invoice.list.paymentStatus.notOverdue', 'Not Overdue')
    }
    const statusClass = (status: string | null) => status === 'ACTIVE' ? 'bg-status-success-bg text-status-success-text' : status === 'CANCELLED' ? 'bg-status-error-bg text-status-error-text' : 'bg-muted text-muted-foreground'
    const common: ColumnDef<InvoiceRow>[] = [
      { accessorKey: 'partnerName', header: t('invoice.list.columns.partner'), meta: { maxWidth: '22rem' } },
      { id: 'invoiceNumber', accessorKey: 'invoiceNumber', header: t('invoice.list.columns.number'), meta: { maxWidth: '16rem' }, cell: ({ row }) => [row.original.invoiceSymbol, row.original.invoiceNumber].filter(Boolean).join(' · ') || '—' },
      { accessorKey: 'dueDate', header: t('invoice.list.columns.dueDate'), meta: { maxWidth: '9rem', width: direction === 'AR' ? '0.6fr' : undefined }, cell: ({ row }) => dateLabel(row.original.dueDate) },
    ]
    const installments: ColumnDef<InvoiceRow> = { id: 'installments', header: t('invoice.list.columns.installments', 'Installments'), meta: { width: direction === 'AR' ? '0.8fr' : undefined }, cell: ({ row }) => row.original.hasInstallmentPlan ? <Button type="button" variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); void openInstallments(row.original.id) }}>{t('invoice.list.installments.viewPlan', 'View plan')}</Button> : '—' }
    const total: ColumnDef<InvoiceRow> = { accessorKey: 'grossAmount', header: t('invoice.list.columns.total'), meta: { width: direction === 'AR' ? '1fr' : undefined }, cell: ({ row }) => formatInvoiceMoney(row.original.grossAmount, row.original.currencyCode) }
    const actions: ColumnDef<InvoiceRow> = { id: 'actions', header: t('invoice.list.columns.actions', 'Actions'), meta: { width: direction === 'AR' ? '1.6fr' : undefined }, cell: ({ row }) => {
      const invoice = row.original
      const isBusy = updatingInvoiceId === invoice.id
      const primaryAction = direction === 'AP' ? <Button type="button" variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); router.push(`/backend/invoice/all/${invoice.id}`) }}>{invoice.autoSettled ? t('invoice.actions.autoPaid', 'Auto-paid') : invoice.hasPaid ? t('invoice.actions.paid', 'Paid') : t('invoice.actions.paidQuestion', 'Paid?')}</Button> : direction === 'AR' ? <Button type="button" variant={invoice.hasReceived ? 'secondary' : 'outline'} size="sm" disabled={isBusy || invoice.nonRecoverable} onClick={(event) => { event.stopPropagation(); void updateSettlement(invoice, !invoice.hasReceived) }}>{invoice.hasReceived ? t('invoice.actions.received', 'Received') : t('invoice.actions.markReceived', 'Mark as received')}</Button> : null
      return <><div className="flex items-center justify-end gap-1">{primaryAction}{direction === 'AR' && <IconButton type="button" variant="ghost" size="sm" aria-label={t('invoice.actions.installments', 'Installments')} disabled={isBusy || invoice.hasReceived} onClick={(event) => { event.stopPropagation(); void openInstallments(invoice.id) }}><CalendarDays /></IconButton>}{direction === 'AR' && <IconButton type="button" variant="ghost" size="sm" aria-label={invoice.nonRecoverable ? t('invoice.actions.recover', 'Mark recoverable') : t('invoice.actions.nonRecoverable', 'Mark non-recoverable')} disabled={isBusy || invoice.hasReceived} onClick={(event) => { event.stopPropagation(); void updateRecoverability(invoice) }}><Ban /></IconButton>}<IconButton type="button" variant="ghost" size="sm" aria-label={t('invoice.actions.edit', 'Edit')} onClick={(event) => { event.stopPropagation(); router.push(`/backend/invoice/all/${invoice.id}/edit`) }}><Pencil /></IconButton><IconButton type="button" variant="ghost" size="sm" aria-label={t('invoice.actions.delete', 'Delete')} onClick={(event) => { event.stopPropagation(); setDeletingInvoiceId(invoice.id) }}><Trash2 /></IconButton></div><Dialog open={deletingInvoiceId === invoice.id} onOpenChange={(open) => { if (!open) setDeletingInvoiceId(null) }}><DialogContent><DialogHeader><DialogTitle>{t('invoice.actions.deleteConfirm', 'Delete invoice?')}</DialogTitle></DialogHeader><div className="flex justify-end gap-2"><Button type="button" variant="soft" onClick={() => setDeletingInvoiceId(null)}>{t('common.cancel', 'Cancel')}</Button><Button type="button" variant="destructive" onClick={() => void deleteInvoice()}>{t('common.delete', 'Delete')}</Button></div></DialogContent></Dialog></>
    } }
    if (!direction) return [
      { accessorKey: 'direction', header: t('invoice.list.columns.direction'), meta: { maxWidth: '7rem' }, cell: ({ row }) => <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">{row.original.direction}</span> },
      ...common,
      installments,
      { accessorKey: 'invoiceStatus', header: t('invoice.list.columns.status', 'Status'), meta: { maxWidth: '9rem' }, cell: ({ row }) => <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(row.original.invoiceStatus)}`}>{row.original.invoiceStatus ? t(`invoice.status.${row.original.invoiceStatus.toLowerCase()}`, row.original.invoiceStatus) : '—'}</span> },
      total,
      actions,
    ]
    return [...common, { id: 'paymentStatus', header: t('invoice.list.columns.paymentStatus', 'Payment Status'), meta: { width: direction === 'AR' ? '0.8fr' : undefined }, cell: ({ row }) => paymentStatus(row.original.nextDueDate) }, installments, total, actions]
  }, [deleteInvoice, deletingInvoiceId, direction, openInstallments, router, t, updateRecoverability, updateSettlement, updatingInvoiceId])
  columns.forEach((column) => {
    if ('accessorKey' in column) {
      column.enableSorting = column.accessorKey === 'dueDate' || column.accessorKey === 'grossAmount'
    } else {
      column.enableSorting = false
    }
  })
  if (loading && !payload) return <Page><PageBody><LoadingMessage label={t('invoice.list.loading')} /></PageBody></Page>
  if (failed && !payload) return <Page><PageBody><ErrorMessage label={t('invoice.list.error')} action={<Button type="button" onClick={() => void load()}>{t('invoice.actions.retry')}</Button>} /></PageBody></Page>
  const rows = payload?.items ?? []
  const sorting: SortingState = searchParams.get('sortField') ? [{ id: searchParams.get('sortField')!, desc: searchParams.get('sortDir') === 'desc' }] : []
  const directionSummary = direction ? summary?.[direction === 'AP' ? 'ap' : 'ar'] : null
  const overview = directionSummary ? [
    [t('invoice.overview.amountUnpaid', 'Amount unpaid'), formatInvoiceMoney(directionSummary.outstandingAmount, summary?.currency)],
    [t('invoice.overview.amountSettled', 'Amount settled'), formatInvoiceMoney(directionSummary.settledAmount, summary?.currency)],
    ...(direction === 'AR'
      ? [
          [t('invoice.overview.unreceivedInvoices', 'Unreceived invoice'), directionSummary.unreceivedInvoices],
          [t('invoice.overview.receivedInvoices', 'Received invoice'), directionSummary.receivedInvoices],
          [t('invoice.overview.partialInvoices', 'Partial invoice'), directionSummary.partiallyPaidInvoices],
          [t('invoice.overview.nonRecoverableInvoices', 'Non-recoverable invoice'), directionSummary.nonRecoverableInvoices],
        ]
      : [
          [t('invoice.overview.unpaidInvoices', 'Unpaid invoices'), directionSummary.unpaidInvoices],
          [t('invoice.overview.partialInvoices', 'Partial invoices'), directionSummary.partiallyPaidInvoices],
          [t('invoice.overview.paidInvoices', 'Paid invoices'), directionSummary.paidInvoices],
        ]),
  ] : []
  return <Page className="min-w-0"><PageHeader title={t(direction === 'AP' ? 'invoice.list.payables' : direction === 'AR' ? 'invoice.list.receivables' : 'invoice.list.all')} /><PageBody className="min-w-0">{overview.length > 0 && <div className={`grid gap-3 sm:grid-cols-2 ${direction === 'AR' ? 'xl:grid-cols-3' : 'xl:grid-cols-5'}`}>{overview.map(([label, value]) => <div key={label} className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2"><p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-2 font-medium text-foreground">{value}</p></div>)}</div>}<div className="mb-4 flex flex-wrap items-center gap-2">
    {!direction && <InvoiceFilter ariaLabel={t('invoice.list.columns.direction')} value={activeDirection} onChange={(value) => setFilter('direction', value)} options={[{ value: 'all', label: t('invoice.list.direction.all', 'All') }, { value: 'AR', label: t('invoice.list.receivables') }, { value: 'AP', label: t('invoice.list.payables') }]} />}
    {direction !== 'AP' && <InvoiceFilter ariaLabel={t('invoice.list.recoverability.label', 'Recoverability')} value={recoverability} onChange={(value) => setFilter('recoverability', value)} options={[{ value: 'all', label: t('invoice.list.recoverability.all', 'Recoverability: All') }, { value: 'recoverable', label: t('invoice.list.recoverability.recoverable', 'Recoverability: Recoverable') }, { value: 'nonRecoverable', label: t('invoice.list.recoverability.nonRecoverable', 'Recoverability: Non-Recoverable') }]} />}
    <IssuedDateFilter fromDate={fromDate} toDate={toDate} onChange={setIssuedDates} />
  </div><DataTable<InvoiceRow> title={undefined} actions={showSyncButton ? <div className="flex items-center gap-2"><InvoiceSyncButton onCompleted={() => void load()} /><Button type="button" onClick={() => router.push('/backend/invoice/create')}>{t('invoice.actions.new', 'New invoice')}</Button></div> : undefined} columns={columns} data={rows} searchValue={search} onSearchChange={(value) => { const params = new URLSearchParams(searchParams.toString()); value ? params.set('search', value) : params.delete('search'); params.delete('page'); router.push(`?${params}`) }} searchPlaceholder={t('invoice.list.search')} onRowClick={(row) => router.push(`/backend/invoice/all/${row.id}`)} sortable manualSorting sorting={sorting} onSortingChange={(current) => { const params = new URLSearchParams(searchParams.toString()); if (current[0]) { params.set('sortField', current[0].id); params.set('sortDir', current[0].desc ? 'desc' : 'asc') } router.push(`?${params}`) }} pagination={{ page: payload?.page ?? page, pageSize: payload?.pageSize ?? 50, total: payload?.total ?? 0, totalPages: payload?.totalPages ?? 0, onPageChange: (next) => { const params = new URLSearchParams(searchParams.toString()); params.set('page', String(next)); router.push(`?${params}`) } }} emptyState={<EmptyState title={t('invoice.list.emptyTitle')} description={t('invoice.list.emptyDescription')} />} isLoading={loading} mobileFit={mobileFit} />{installmentsId && <InstallmentsDialog invoiceId={installmentsId} onClose={closeInstallments} onChanged={() => void load()} />}</PageBody></Page>
}
