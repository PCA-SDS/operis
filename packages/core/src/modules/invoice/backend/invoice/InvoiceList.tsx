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
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Ban, CalendarDays, Pencil, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Dropdown } from '@open-mercato/ui/primitives/dropdown'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type InvoiceRow = { id: string; direction: 'AP' | 'AR'; companyId: string | null; partnerName: string | null; invoiceSymbol: string | null; invoiceNumber: string | null; invoiceDate: string | null; dueDate: string | null; nextDueDate: string | null; currencyCode: string | null; grossAmount: string | null; settlementStatus: string | null; invoiceStatus: string | null; hasInstallmentPlan: boolean; hasReceived: boolean; hasPaid: boolean; autoSettled: boolean; nonRecoverable: boolean; lastSentAt: string | null; origin: string | null }
type Response = { items: InvoiceRow[]; total: number; page: number; pageSize: number; totalPages: number }
type DirectionSummary = { outstandingAmount: string; settledAmount: string; unpaidInvoices: number; partiallyPaidInvoices: number; paidInvoices: number; unreceivedInvoices: number; receivedInvoices: number; nonRecoverableInvoices: number }
type SummaryResponse = { currency: 'VND'; ar: DirectionSummary; ap: DirectionSummary }
type Installment = { id: string; sequence: number; principalAmount: string; interestRate: string; interestAmount: string; totalAmount: string; dueDate: string | null; status: string; note: string | null }
type InvoiceDetail = InvoiceRow & { installments: Installment[] }

type FilterOption = { value: string; label: string }

function InvoiceFilter({ value, options, onChange, ariaLabel }: { value: string; options: FilterOption[]; onChange: (value: string) => void; ariaLabel: string }) {
  const selected = options.find((option) => option.value === value)
  return <Dropdown value={value} options={options} onChange={(next) => onChange(next ?? 'all')} placeholder={selected?.label ?? options[0]?.label ?? ''} triggerLabel={selected?.label ?? options[0]?.label} ariaLabel={ariaLabel} triggerLeading={false} variant="filter" size="default" />
}

export function InvoiceList({ direction }: { direction?: 'AP' | 'AR' }) {
  const t = useT(); const router = useRouter(); const searchParams = useSearchParams()
  const [payload, setPayload] = React.useState<Response | null>(null); const [loading, setLoading] = React.useState(true); const [failed, setFailed] = React.useState(false)
  const [summary, setSummary] = React.useState<SummaryResponse | null>(null)
  const [installments, setInstallments] = React.useState<Installment[]>([])
  const [installmentInvoice, setInstallmentInvoice] = React.useState<InvoiceRow | null>(null)
  const [installmentsOpen, setInstallmentsOpen] = React.useState(false)
  const [deletingInvoiceId, setDeletingInvoiceId] = React.useState<string | null>(null)
  const [updatingInvoiceId, setUpdatingInvoiceId] = React.useState<string | null>(null)
  const page = Number(searchParams.get('page') ?? '1') || 1; const search = searchParams.get('search') ?? ''
  const recoverability = searchParams.get('recoverability') ?? 'all'
  const fromDate = searchParams.get('fromDate') ?? ''
  const toDate = searchParams.get('toDate') ?? ''
  const [issuedMode, setIssuedMode] = React.useState<'between' | 'before' | 'on' | 'after'>('between')
  const [issuedMonth, setIssuedMonth] = React.useState(() => {
    const date = new Date(fromDate || toDate || Date.now())
    return new Date(date.getFullYear(), date.getMonth(), 1)
  })
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
    const call = await apiCall(`/api/invoice/invoices/${deletingInvoiceId}`, { method: 'DELETE' })
    if (call.ok) { setDeletingInvoiceId(null); void load() }
  }, [deletingInvoiceId, load])
  const updateSettlement = React.useCallback(async (invoice: InvoiceRow, settled: boolean) => {
    if (direction === 'AP') {
      router.push(`/backend/invoice/all/${invoice.id}`)
      return
    }
    setUpdatingInvoiceId(invoice.id)
    await apiCall(`/api/invoice/invoices/${invoice.id}/settlement`, { method: 'PATCH', body: JSON.stringify({ settled }) })
    setUpdatingInvoiceId(null)
    void load()
  }, [direction, load, router])
  const updateRecoverability = React.useCallback(async (invoice: InvoiceRow) => {
    setUpdatingInvoiceId(invoice.id)
    await apiCall(`/api/invoice/invoices/${invoice.id}/non-recoverable`, { method: 'PATCH', body: JSON.stringify({ nonRecoverable: !invoice.nonRecoverable, note: !invoice.nonRecoverable ? 'Marked from receivables' : null }) })
    setUpdatingInvoiceId(null)
    void load()
  }, [load])
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
      { accessorKey: 'partnerName', header: t('invoice.list.columns.partner'), meta: { maxWidth: '22rem' } },
      { id: 'invoiceNumber', accessorKey: 'invoiceNumber', header: t('invoice.list.columns.number'), meta: { maxWidth: '16rem' }, cell: ({ row }) => [row.original.invoiceSymbol, row.original.invoiceNumber].filter(Boolean).join(' · ') || '—' },
      { accessorKey: 'dueDate', header: t('invoice.list.columns.dueDate'), meta: { maxWidth: '9rem' }, cell: ({ row }) => dateLabel(row.original.dueDate) },
    ]
    const installments: ColumnDef<InvoiceRow> = { id: 'installments', header: t('invoice.list.columns.installments', { fallback: 'Installments' }), cell: ({ row }) => row.original.hasInstallmentPlan ? <Button type="button" variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); void openInstallments(row.original.id) }}>{t('invoice.list.installments.viewPlan', { fallback: 'View plan' })}</Button> : '—' }
    const total: ColumnDef<InvoiceRow> = { accessorKey: 'grossAmount', header: t('invoice.list.columns.total'), cell: ({ row }) => row.original.grossAmount ? `${Number(row.original.grossAmount).toLocaleString()} ${row.original.currencyCode ?? ''}` : '—' }
    const actions: ColumnDef<InvoiceRow> = { id: 'actions', header: t('invoice.list.columns.actions', { fallback: 'Actions' }), cell: ({ row }) => {
      const invoice = row.original
      const isBusy = updatingInvoiceId === invoice.id
      const primaryAction = direction === 'AP' ? <Button type="button" variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); router.push(`/backend/invoice/all/${invoice.id}`) }}>{invoice.autoSettled ? t('invoice.actions.autoPaid', { fallback: 'Auto-paid' }) : invoice.hasPaid ? t('invoice.actions.paid', { fallback: 'Paid' }) : t('invoice.actions.paidQuestion', { fallback: 'Paid?' })}</Button> : direction === 'AR' ? <Button type="button" variant={invoice.hasReceived ? 'secondary' : 'outline'} size="sm" disabled={isBusy || invoice.nonRecoverable} onClick={(event) => { event.stopPropagation(); void updateSettlement(invoice, !invoice.hasReceived) }}>{invoice.hasReceived ? t('invoice.actions.received', { fallback: 'Received' }) : t('invoice.actions.markReceived', { fallback: 'Mark as received' })}</Button> : null
      return <><div className="flex items-center justify-end gap-1">{primaryAction}{direction === 'AR' && <IconButton type="button" variant="ghost" size="sm" aria-label={t('invoice.actions.installments', { fallback: 'Installments' })} disabled={isBusy || invoice.hasReceived} onClick={(event) => { event.stopPropagation(); void openInstallments(invoice.id) }}><CalendarDays /></IconButton>}{direction === 'AR' && <IconButton type="button" variant="ghost" size="sm" aria-label={invoice.nonRecoverable ? t('invoice.actions.recover', { fallback: 'Mark recoverable' }) : t('invoice.actions.nonRecoverable', { fallback: 'Mark non-recoverable' })} disabled={isBusy || invoice.hasReceived} onClick={(event) => { event.stopPropagation(); void updateRecoverability(invoice) }}><Ban /></IconButton>}<IconButton type="button" variant="ghost" size="sm" aria-label={t('invoice.actions.edit', { fallback: 'Edit' })} onClick={(event) => { event.stopPropagation(); router.push(`/backend/invoice/all/${invoice.id}/edit`) }}><Pencil /></IconButton><IconButton type="button" variant="ghost" size="sm" aria-label={t('invoice.actions.delete', { fallback: 'Delete' })} onClick={(event) => { event.stopPropagation(); setDeletingInvoiceId(invoice.id) }}><Trash2 /></IconButton></div><Dialog open={deletingInvoiceId === invoice.id} onOpenChange={(open) => { if (!open) setDeletingInvoiceId(null) }}><DialogContent><DialogHeader><DialogTitle>{t('invoice.actions.deleteConfirm', { fallback: 'Delete invoice?' })}</DialogTitle></DialogHeader><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setDeletingInvoiceId(null)}>{t('common.cancel', { fallback: 'Cancel' })}</Button><Button type="button" variant="destructive" onClick={() => void deleteInvoice()}>{t('common.delete', { fallback: 'Delete' })}</Button></div></DialogContent></Dialog></>
    } }
    if (!direction) return [
      { accessorKey: 'direction', header: t('invoice.list.columns.direction'), meta: { maxWidth: '7rem' }, cell: ({ row }) => <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">{row.original.direction}</span> },
      ...common,
      installments,
      { accessorKey: 'invoiceStatus', header: t('invoice.list.columns.status', { fallback: 'Status' }), meta: { maxWidth: '9rem' }, cell: ({ row }) => <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(row.original.invoiceStatus)}`}>{row.original.invoiceStatus ? t(`invoice.status.${row.original.invoiceStatus.toLowerCase()}`, { fallback: row.original.invoiceStatus }) : '—'}</span> },
      total,
      actions,
    ]
    return [...common, { id: 'paymentStatus', header: t('invoice.list.columns.paymentStatus', { fallback: 'Payment Status' }), cell: ({ row }) => paymentStatus(row.original.nextDueDate) }, installments, total, actions]
  }, [deleteInvoice, direction, openInstallments, router, t, updateRecoverability, updateSettlement, updatingInvoiceId])
  if (loading && !payload) return <Page><PageBody><LoadingMessage label={t('invoice.list.loading')} /></PageBody></Page>
  if (failed && !payload) return <Page><PageBody><ErrorMessage label={t('invoice.list.error')} action={<Button type="button" onClick={() => void load()}>{t('invoice.actions.retry')}</Button>} /></PageBody></Page>
  const rows = payload?.items ?? []
  const sorting: SortingState = searchParams.get('sortField') ? [{ id: searchParams.get('sortField')!, desc: searchParams.get('sortDir') === 'desc' }] : []
  const directionSummary = direction ? summary?.[direction === 'AP' ? 'ap' : 'ar'] : null
  const overview = directionSummary ? [
    [t('invoice.overview.amountUnpaid', { fallback: 'Amount unpaid' }), `${Number(directionSummary.outstandingAmount).toLocaleString()} ${summary?.currency}`],
    [t('invoice.overview.amountSettled', { fallback: 'Amount settled' }), `${Number(directionSummary.settledAmount).toLocaleString()} ${summary?.currency}`],
    ...(direction === 'AR'
      ? [
          [t('invoice.overview.unreceivedInvoices', { fallback: 'Unreceived invoice' }), directionSummary.unreceivedInvoices],
          [t('invoice.overview.receivedInvoices', { fallback: 'Received invoice' }), directionSummary.receivedInvoices],
          [t('invoice.overview.partialInvoices', { fallback: 'Partial invoice' }), directionSummary.partiallyPaidInvoices],
          [t('invoice.overview.nonRecoverableInvoices', { fallback: 'Non-recoverable invoice' }), directionSummary.nonRecoverableInvoices],
        ]
      : [
          [t('invoice.overview.unpaidInvoices', { fallback: 'Unpaid invoices' }), directionSummary.unpaidInvoices],
          [t('invoice.overview.partialInvoices', { fallback: 'Partial invoices' }), directionSummary.partiallyPaidInvoices],
          [t('invoice.overview.paidInvoices', { fallback: 'Paid invoices' }), directionSummary.paidInvoices],
        ]),
  ] : []
  const issuedLabel = fromDate || toDate ? `${fromDate || '…'} – ${toDate || '…'}` : t('invoice.list.all', { fallback: 'All' })
  const monthStart = new Date(issuedMonth.getFullYear(), issuedMonth.getMonth(), 1)
  const calendarStart = new Date(monthStart); calendarStart.setDate(1 - ((monthStart.getDay() + 6) % 7))
  const calendarDays = Array.from({ length: 42 }, (_, index) => { const date = new Date(calendarStart); date.setDate(calendarStart.getDate() + index); return date })
  const formatDate = (date: Date) => { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0'); return `${year}-${month}-${day}` }
  const chooseIssuedDate = (date: Date) => {
    const value = formatDate(date)
    if (issuedMode === 'before') return setIssuedDates('', value)
    if (issuedMode === 'after') return setIssuedDates(value, '')
    if (issuedMode === 'on') return setIssuedDates(value, value)
    if (!fromDate || (fromDate && toDate)) return setIssuedDates(value, '')
    return setIssuedDates(fromDate <= value ? fromDate : value, fromDate <= value ? value : fromDate)
  }
  const quickRange = (days: number) => { const end = new Date(); const start = new Date(); start.setDate(end.getDate() - days + 1); setIssuedDates(formatDate(start), formatDate(end)) }
  return <Page><PageBody>{overview.length > 0 && <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{overview.map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-surface px-3 py-2"><p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-2 font-medium text-foreground">{value}</p></div>)}</div>}<div className="mb-4 flex flex-wrap items-center gap-2">
    {!direction && <InvoiceFilter ariaLabel={t('invoice.list.columns.direction')} value={activeDirection} onChange={(value) => setFilter('direction', value)} options={[{ value: 'all', label: t('invoice.list.direction.all', { fallback: 'All' }) }, { value: 'AR', label: t('invoice.list.receivables') }, { value: 'AP', label: t('invoice.list.payables') }]} />}
    {direction !== 'AP' && <InvoiceFilter ariaLabel={t('invoice.list.recoverability.label', { fallback: 'Recoverability' })} value={recoverability} onChange={(value) => setFilter('recoverability', value)} options={[{ value: 'all', label: t('invoice.list.recoverability.all', { fallback: 'Recoverability: All' }) }, { value: 'recoverable', label: t('invoice.list.recoverability.recoverable', { fallback: 'Recoverability: Recoverable' }) }, { value: 'nonRecoverable', label: t('invoice.list.recoverability.nonRecoverable', { fallback: 'Recoverability: Non-Recoverable' }) }]} />}
    <details className="group relative">
      <summary aria-label={t('invoice.list.issued', { fallback: 'Issued' })} className="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground shadow-sm outline-none transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-focus-ring/30"><span aria-hidden="true">▣</span><span>{t('invoice.list.issued', { fallback: 'Issued' })}: {issuedLabel}</span><span className="text-muted-foreground transition-transform group-open:rotate-180">⌃</span></summary>
      <div className="absolute right-0 z-20 mt-3 grid min-w-[42rem] grid-cols-[13rem_1fr] gap-0 rounded-3xl border border-border bg-surface p-5 shadow-xl">
        <div className="border-r border-border pr-5"><p className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t('invoice.list.issued.quickRanges', { fallback: 'Quick ranges' })}</p>{[['Yesterday', 1], ['Last week', 7], ['Last 7 days', 7], ['Last month', 30], ['Last 3 months', 90], ['Last 12 months', 365]].map(([label, days], index) => <Button key={`${label}-${index}`} type="button" variant="ghost" className="w-full justify-start rounded-xl px-3 text-base" onClick={() => quickRange(Number(days))}>{label}</Button>)}</div>
        <div className="pl-6"><div className="mb-5 flex rounded-xl border border-border p-1">{[['between', 'Between'], ['before', 'Before'], ['on', 'On'], ['after', 'After']].map(([value, label]) => <Button key={value} type="button" variant={issuedMode === value ? 'secondary' : 'ghost'} className="flex-1" onClick={() => setIssuedMode(value as typeof issuedMode)}>{label}</Button>)}</div><p className="mb-4 text-base text-muted-foreground">{issuedMode === 'between' ? 'Pick the start date' : 'Pick a date'}</p><div className="mb-4 flex items-center justify-between"><Button type="button" variant="ghost" onClick={() => setIssuedMonth(new Date(issuedMonth.getFullYear(), issuedMonth.getMonth() - 1, 1))}>‹</Button><span className="text-xl font-semibold">{issuedMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span><Button type="button" variant="ghost" onClick={() => setIssuedMonth(new Date(issuedMonth.getFullYear(), issuedMonth.getMonth() + 1, 1))}>›</Button></div><div className="grid grid-cols-7 text-center text-sm font-semibold text-muted-foreground">{['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map((day) => <span key={day} className="py-2">{day}</span>)}{calendarDays.map((date) => <Button key={date.toISOString()} type="button" variant="ghost" className={`h-10 rounded-full ${date.getMonth() !== issuedMonth.getMonth() ? 'text-muted-foreground' : ''}`} onClick={() => chooseIssuedDate(date)}>{date.getDate()}</Button>)}</div></div>
      </div>
    </details>
  </div><DataTable<InvoiceRow> title={t(direction === 'AP' ? 'invoice.list.payables' : direction === 'AR' ? 'invoice.list.receivables' : 'invoice.list.all')} columns={columns} data={rows} searchValue={search} onSearchChange={(value) => { const params = new URLSearchParams(searchParams.toString()); value ? params.set('search', value) : params.delete('search'); params.delete('page'); router.push(`?${params}`) }} searchPlaceholder={t('invoice.list.search')} onRowClick={(row) => router.push(`/backend/invoice/all/${row.id}`)} sortable manualSorting sorting={sorting} onSortingChange={(current) => { const params = new URLSearchParams(searchParams.toString()); if (current[0]) { params.set('sortField', current[0].id); params.set('sortDir', current[0].desc ? 'desc' : 'asc') } router.push(`?${params}`) }} pagination={{ page: payload?.page ?? page, pageSize: payload?.pageSize ?? 50, total: payload?.total ?? 0, totalPages: payload?.totalPages ?? 0, onPageChange: (next) => { const params = new URLSearchParams(searchParams.toString()); params.set('page', String(next)); router.push(`?${params}`) } }} emptyState={<ListEmptyState entityName={t('invoice.list.all')} />} isLoading={loading} /><Dialog open={installmentsOpen} onOpenChange={setInstallmentsOpen}><DialogContent className="max-w-5xl"><DialogHeader><DialogTitle>{t('invoice.list.installments.title', { fallback: 'Installment plan' })}</DialogTitle></DialogHeader><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-muted-foreground">{[['seq', 'Seq'], ['principal', 'Principal'], ['interestRate', 'Interest rate'], ['interestAmount', 'Interest amount'], ['amount', 'Amount'], ['dueDate', 'Due date'], ['status', 'Status'], ['note', 'Note']].map(([key, fallback]) => <th key={key} className="px-2 py-2 font-medium">{t(`invoice.installments.columns.${key}`, { fallback })}</th>)}</tr></thead><tbody>{installments.map((item) => <tr key={item.id} className="border-b border-border"><td className="px-2 py-2">{item.sequence}</td><td className="px-2 py-2">{item.principalAmount}</td><td className="px-2 py-2">{item.interestRate}</td><td className="px-2 py-2">{item.interestAmount}</td><td className="px-2 py-2">{item.totalAmount}</td><td className="px-2 py-2">{item.dueDate ? new Date(item.dueDate).toLocaleDateString() : '—'}</td><td className="px-2 py-2">{item.status}</td><td className="px-2 py-2">{item.note ?? '—'}</td></tr>)}</tbody></table></div></DialogContent></Dialog></PageBody></Page>
}
