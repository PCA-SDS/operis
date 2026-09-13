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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type InvoiceRow = { id: string; direction: 'AP' | 'AR'; partnerName: string | null; invoiceSymbol: string | null; invoiceNumber: string | null; invoiceDate: string | null; dueDate: string | null; nextDueDate: string | null; currencyCode: string | null; grossAmount: string | null; settlementStatus: string | null; invoiceStatus: string | null; hasInstallmentPlan: boolean; hasReceived: boolean; hasPaid: boolean; autoSettled: boolean; nonRecoverable: boolean; lastSentAt: string | null; origin: string | null }
type Response = { items: InvoiceRow[]; total: number; page: number; pageSize: number; totalPages: number }
type DirectionSummary = { outstandingAmount: string; settledAmount: string; unpaidInvoices: number; partiallyPaidInvoices: number; paidInvoices: number }
type SummaryResponse = { currency: 'VND'; ar: DirectionSummary; ap: DirectionSummary }
type Installment = { id: string; sequence: number; principalAmount: string; interestRate: string; interestAmount: string; totalAmount: string; dueDate: string | null; status: string; note: string | null }
type InvoiceDetail = InvoiceRow & { installments: Installment[] }

export function InvoiceList({ direction }: { direction?: 'AP' | 'AR' }) {
  const t = useT(); const router = useRouter(); const searchParams = useSearchParams()
  const [payload, setPayload] = React.useState<Response | null>(null); const [loading, setLoading] = React.useState(true); const [failed, setFailed] = React.useState(false)
  const [summary, setSummary] = React.useState<SummaryResponse | null>(null)
  const [installments, setInstallments] = React.useState<Installment[]>([])
  const [installmentsOpen, setInstallmentsOpen] = React.useState(false)
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
  const openInstallments = React.useCallback(async (invoiceId: string) => {
    const call = await apiCall<InvoiceDetail>(`/api/invoice/invoices/${invoiceId}`)
    if (!call.ok || !call.result) return
    setInstallments(call.result.installments)
    setInstallmentsOpen(true)
  }, [])
  const load = React.useCallback(async () => { setLoading(true); setFailed(false); const params = new URLSearchParams({ page: String(page), pageSize: '50', sortField: searchParams.get('sortField') ?? 'invoiceDate', sortDir: searchParams.get('sortDir') ?? 'desc' }); if (activeDirection !== 'all') params.set('direction', activeDirection); if (recoverability !== 'all') params.set('recoverability', recoverability); if (fromDate) params.set('fromDate', fromDate); if (toDate) params.set('toDate', toDate); if (search) params.set('search', search); const [call, summaryCall] = await Promise.all([apiCall<Response>(`/api/invoice/invoices?${params}`), direction ? apiCall<SummaryResponse>('/api/invoice/summary') : Promise.resolve(null)]); if (!call.ok || !call.result) setFailed(true); else setPayload(call.result); if (summaryCall?.ok && summaryCall.result) setSummary(summaryCall.result); setLoading(false) }, [activeDirection, direction, fromDate, page, recoverability, search, searchParams, toDate])
  React.useEffect(() => { void load() }, [load])
  const columns = React.useMemo<ColumnDef<InvoiceRow>[]>(() => {
    const dateLabel = (value: string | null) => value ? new Date(value).toLocaleDateString() : '—'
    const paymentStatus = (value: string | null) => {
      if (!value) return '—'
      const due = new Date(value); const today = new Date(); due.setHours(0, 0, 0, 0); today.setHours(0, 0, 0, 0)
      if (Number.isNaN(due.getTime())) return '—'
      if (due.getTime() === today.getTime()) return t('invoice.list.paymentStatus.dueToday', { fallback: 'Due Today' })
      return due < today ? t('invoice.list.paymentStatus.overdue', { fallback: 'Overdue' }) : t('invoice.list.paymentStatus.notOverdue', { fallback: 'Not Overdue' })
    }
    const statusClass = (status: string | null) => status === 'ACTIVE' ? 'bg-status-success-bg text-status-success-text' : status === 'CANCELLED' ? 'bg-status-error-bg text-status-error-text' : 'bg-muted text-muted-foreground'
    const common: ColumnDef<InvoiceRow>[] = [
      { accessorKey: 'partnerName', header: t('invoice.list.columns.partner') },
      { id: 'invoiceNumber', accessorKey: 'invoiceNumber', header: t('invoice.list.columns.number'), cell: ({ row }) => [row.original.invoiceSymbol, row.original.invoiceNumber].filter(Boolean).join(' · ') || '—' },
      { accessorKey: 'dueDate', header: t('invoice.list.columns.dueDate'), cell: ({ row }) => dateLabel(row.original.dueDate) },
    ]
    const installments: ColumnDef<InvoiceRow> = { id: 'installments', header: t('invoice.list.columns.installments', { fallback: 'Installments' }), cell: ({ row }) => row.original.hasInstallmentPlan ? <Button type="button" variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); void openInstallments(row.original.id) }}>{t('invoice.list.installments.viewPlan', { fallback: 'View plan' })}</Button> : '—' }
    const total: ColumnDef<InvoiceRow> = { accessorKey: 'grossAmount', header: t('invoice.list.columns.total'), cell: ({ row }) => row.original.grossAmount ? `${Number(row.original.grossAmount).toLocaleString()} ${row.original.currencyCode ?? ''}` : '—' }
    const actions: ColumnDef<InvoiceRow> = { id: 'actions', header: t('invoice.list.columns.actions', { fallback: 'Actions' }), cell: ({ row }) => {
      const invoice = row.original
      let label = t('invoice.actions.view', { fallback: 'View' })
      if (direction === 'AP') label = invoice.autoSettled ? t('invoice.actions.autoPaid', { fallback: '⚡ Auto-paid' }) : invoice.hasPaid ? t('invoice.actions.paid', { fallback: '✓ Paid' }) : invoice.lastSentAt ? t('invoice.actions.pending', { fallback: 'Pending' }) : t('invoice.actions.paidQuestion', { fallback: 'Paid?' })
      if (direction === 'AR') label = invoice.nonRecoverable ? t('invoice.actions.nonRecoverable', { fallback: 'Non-Recoverable' }) : invoice.hasReceived ? t('invoice.actions.received', { fallback: '✓ Received' }) : t('invoice.actions.markReceived', { fallback: 'Mark as Received' })
      return <Button type="button" variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); router.push(`/backend/invoice/all/${invoice.id}`) }}>{label}</Button>
    } }
    if (!direction) return [
      { accessorKey: 'direction', header: t('invoice.list.columns.direction'), cell: ({ row }) => <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">{row.original.direction}</span> },
      ...common,
      installments,
      { accessorKey: 'invoiceStatus', header: t('invoice.list.columns.status', { fallback: 'Status' }), cell: ({ row }) => <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(row.original.invoiceStatus)}`}>{row.original.invoiceStatus ? t(`invoice.status.${row.original.invoiceStatus.toLowerCase()}`, { fallback: row.original.invoiceStatus }) : '—'}</span> },
      total,
      actions,
    ]
    return [...common, { id: 'paymentStatus', header: t('invoice.list.columns.paymentStatus', { fallback: 'Payment Status' }), cell: ({ row }) => paymentStatus(row.original.nextDueDate) }, installments, total, actions]
  }, [direction, openInstallments, router, t])
  if (loading && !payload) return <Page><PageBody><LoadingMessage label={t('invoice.list.loading')} /></PageBody></Page>
  if (failed && !payload) return <Page><PageBody><ErrorMessage label={t('invoice.list.error')} action={<Button type="button" onClick={() => void load()}>{t('invoice.actions.retry')}</Button>} /></PageBody></Page>
  const rows = payload?.items ?? []
  const sorting: SortingState = searchParams.get('sortField') ? [{ id: searchParams.get('sortField')!, desc: searchParams.get('sortDir') === 'desc' }] : []
  const directionSummary = direction ? summary?.[direction === 'AP' ? 'ap' : 'ar'] : null
  const overview = directionSummary ? [
    [t('invoice.overview.amountUnpaid', { fallback: 'Amount unpaid' }), `${Number(directionSummary.outstandingAmount).toLocaleString()} ${summary?.currency}`],
    [t('invoice.overview.amountSettled', { fallback: 'Amount settled' }), `${Number(directionSummary.settledAmount).toLocaleString()} ${summary?.currency}`],
    [t('invoice.overview.unpaidInvoices', { fallback: 'Unpaid invoices' }), directionSummary.unpaidInvoices],
    [t('invoice.overview.partialInvoices', { fallback: 'Partial invoices' }), directionSummary.partiallyPaidInvoices],
    [t('invoice.overview.paidInvoices', { fallback: 'Paid invoices' }), directionSummary.paidInvoices],
  ] : []
  return <Page><PageBody>{overview.length > 0 && <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{overview.map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-surface px-3 py-2"><p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-2 font-medium text-foreground">{value}</p></div>)}</div>}<div className="mb-4 flex flex-wrap items-center gap-2">
    {!direction && <select aria-label={t('invoice.list.columns.direction')} className="rounded-lg border border-border bg-input-bg px-3 py-2 text-sm" value={activeDirection} onChange={(event) => setFilter('direction', event.target.value)}>
      <option value="all">{t('invoice.list.direction.all', { fallback: 'All' })}</option>
      <option value="AR">{t('invoice.list.receivables')}</option>
      <option value="AP">{t('invoice.list.payables')}</option>
    </select>}
    {direction !== 'AP' && <select aria-label={t('invoice.list.recoverability.label', { fallback: 'Recoverability' })} className="rounded-lg border border-border bg-input-bg px-3 py-2 text-sm" value={recoverability} onChange={(event) => setFilter('recoverability', event.target.value)}>
      <option value="all">{t('invoice.list.recoverability.all', { fallback: 'Recoverability: All' })}</option>
      <option value="recoverable">{t('invoice.list.recoverability.recoverable', { fallback: 'Recoverability: Recoverable' })}</option>
      <option value="nonRecoverable">{t('invoice.list.recoverability.nonRecoverable', { fallback: 'Recoverability: Non-Recoverable' })}</option>
    </select>}
    <details className="relative rounded-lg border border-border bg-input-bg px-3 py-2 text-sm">
      <summary className="cursor-pointer list-none text-foreground">{t('invoice.list.issued', { fallback: 'Issued' })}: {fromDate || toDate ? `${fromDate || '…'} – ${toDate || '…'}` : t('invoice.list.all', { fallback: 'All' })}</summary>
      <div className="absolute right-0 z-10 mt-2 grid min-w-64 gap-3 rounded-lg border border-border bg-surface p-3 shadow-lg">
        <label className="grid gap-1"><span className="text-xs text-muted-foreground">{t('invoice.list.issued.from', { fallback: 'From' })}</span><input className="rounded-md border border-border bg-input-bg px-2 py-1.5" type="date" value={fromDate} onChange={(event) => setFilter('fromDate', event.target.value)} /></label>
        <label className="grid gap-1"><span className="text-xs text-muted-foreground">{t('invoice.list.issued.to', { fallback: 'To' })}</span><input className="rounded-md border border-border bg-input-bg px-2 py-1.5" type="date" value={toDate} onChange={(event) => setFilter('toDate', event.target.value)} /></label>
        {(fromDate || toDate) && <button className="text-left text-sm text-muted-foreground hover:text-foreground" type="button" onClick={() => { const params = new URLSearchParams(searchParams.toString()); params.delete('fromDate'); params.delete('toDate'); params.delete('page'); router.push(`?${params}`) }}>{t('invoice.list.issued.clear', { fallback: 'Clear dates' })}</button>}
      </div>
    </details>
  </div><DataTable<InvoiceRow> title={t(direction === 'AP' ? 'invoice.list.payables' : direction === 'AR' ? 'invoice.list.receivables' : 'invoice.list.all')} columns={columns} data={rows} searchValue={search} onSearchChange={(value) => { const params = new URLSearchParams(searchParams.toString()); value ? params.set('search', value) : params.delete('search'); params.delete('page'); router.push(`?${params}`) }} searchPlaceholder={t('invoice.list.search')} onRowClick={(row) => router.push(`/backend/invoice/all/${row.id}`)} sortable manualSorting sorting={sorting} onSortingChange={(current) => { const params = new URLSearchParams(searchParams.toString()); if (current[0]) { params.set('sortField', current[0].id); params.set('sortDir', current[0].desc ? 'desc' : 'asc') } router.push(`?${params}`) }} pagination={{ page: payload?.page ?? page, pageSize: payload?.pageSize ?? 50, total: payload?.total ?? 0, totalPages: payload?.totalPages ?? 0, onPageChange: (next) => { const params = new URLSearchParams(searchParams.toString()); params.set('page', String(next)); router.push(`?${params}`) } }} emptyState={<ListEmptyState entityName={t('invoice.list.all')} />} isLoading={loading} /><Dialog open={installmentsOpen} onOpenChange={setInstallmentsOpen}><DialogContent className="max-w-5xl"><DialogHeader><DialogTitle>{t('invoice.list.installments.title', { fallback: 'Installment plan' })}</DialogTitle></DialogHeader><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-muted-foreground">{[['seq', 'Seq'], ['principal', 'Principal'], ['interestRate', 'Interest rate'], ['interestAmount', 'Interest amount'], ['amount', 'Amount'], ['dueDate', 'Due date'], ['status', 'Status'], ['note', 'Note']].map(([key, fallback]) => <th key={key} className="px-2 py-2 font-medium">{t(`invoice.installments.columns.${key}`, { fallback })}</th>)}</tr></thead><tbody>{installments.map((item) => <tr key={item.id} className="border-b border-border"><td className="px-2 py-2">{item.sequence}</td><td className="px-2 py-2">{item.principalAmount}</td><td className="px-2 py-2">{item.interestRate}</td><td className="px-2 py-2">{item.interestAmount}</td><td className="px-2 py-2">{item.totalAmount}</td><td className="px-2 py-2">{item.dueDate ? new Date(item.dueDate).toLocaleDateString() : '—'}</td><td className="px-2 py-2">{item.status}</td><td className="px-2 py-2">{item.note ?? '—'}</td></tr>)}</tbody></table></div></DialogContent></Dialog></PageBody></Page>
}
