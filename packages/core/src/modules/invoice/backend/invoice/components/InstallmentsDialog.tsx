'use client'

import * as React from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import { useInvoiceT as useT } from '../../../lib/useInvoiceT'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { localDate, addCalendarMonths } from '../../../lib/localDates'
import { invoiceInstallmentPlanUpdateSchema } from '../../../data/validators'

type PlanItem = {
  id?: string
  sequence?: number
  principalAmount: string
  interestRate: string
  interestAmount?: string
  totalAmount?: string
  dueDate: string | null
  status?: string
  note: string | null
}

type Invoice = {
  id: string
  invoiceSymbol: string | null
  invoiceNumber: string | null
  partnerName: string | null
  currencyCode: string | null
  grossAmount: string | null
  paidAmount: string | null
  outstandingAmount: string | null
  updatedAt: string | null
  installments: PlanItem[]
}

const money = (value: string | number | null | undefined) => Number(value ?? 0).toLocaleString()
const dateValue = (value: string | null) => value ? localDate(value) : ''
const addMonths = addCalendarMonths
const splitPrincipal = (total: number, count: number) => {
  const base = Math.floor((total / count) * 100) / 100
  return Array.from({ length: count }, (_, index) => index === count - 1
    ? (total - base * (count - 1)).toFixed(2)
    : base.toFixed(2))
}

export function InstallmentsDialog({ invoiceId, onClose, onChanged }: { invoiceId: string; onClose: () => void; onChanged: () => void }) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation({ contextId: 'invoice.installments' })
  const [invoice, setInvoice] = React.useState<Invoice | null>(null)
  const [editing, setEditing] = React.useState(false)
  const [rows, setRows] = React.useState<PlanItem[]>([])
  const [busy, setBusy] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [bounds, setBounds] = React.useState<React.CSSProperties>({})
  React.useEffect(() => {
    const element = document.querySelector<HTMLElement>('[data-app-shell-column]') ?? document.documentElement
    const measure = () => {
      const rect = element.getBoundingClientRect()
      if (window.innerWidth < 640) return setBounds({})
      const left = Math.max(0, rect.left)
      const available = Math.min(window.innerWidth, rect.right) - left
      setBounds({ left: left + available / 2, width: Math.min(1120, available - 32), maxWidth: Math.max(0, available - 32) })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  const refreshInvoice = React.useCallback(async () => {
    const result = await apiCall<Invoice>(`/api/invoice/invoices/${invoiceId}`)
    setFailed(!result.ok || !result.result)
    if (result.ok && result.result) setInvoice(result.result)
  }, [invoiceId])

  React.useEffect(() => { void refreshInvoice() }, [refreshInvoice])

  if (!invoice) {
    return <Dialog open onOpenChange={onClose}><DialogContent style={bounds}><DialogTitle>{t('invoice.list.installments.title')}</DialogTitle>{failed ? <ErrorMessage label={t('invoice.detail.error')} action={<Button type="button" onClick={() => void refreshInvoice()}>{t('invoice.actions.retry')}</Button>} /> : <LoadingMessage label={t('invoice.list.loading')} />}</DialogContent></Dialog>
  }

  const hasPlan = invoice.installments.length > 0
  const hasPaidInstallment = invoice.installments.some((item) => item.status === 'PAID')
  const invoiceTotal = Number(invoice.grossAmount ?? 0)
  const principalTotal = rows.reduce((sum, item) => sum + Number(item.principalAmount || 0), 0)
  const interestTotal = rows.reduce((sum, item) => sum + (Number(item.principalAmount || 0) * Number(item.interestRate || 0) / 100), 0)
  const principalMatchesTotal = Math.abs(principalTotal - invoiceTotal) < 0.0001
  const canSave = invoiceInstallmentPlanUpdateSchema.safeParse({ installments: rows.map((item) => ({ principalAmount: item.principalAmount, interestRate: item.interestRate, dueDate: item.dueDate, note: item.note })) }).success && principalMatchesTotal

  const startEdit = () => {
    if (hasPaidInstallment) return
    if (hasPlan) {
      setRows(invoice.installments.map((item) => ({ ...item, dueDate: dateValue(item.dueDate) })))
    } else {
      const start = localDate(new Date())
      setRows(splitPrincipal(invoiceTotal, 2).map((principal, index) => ({
        principalAmount: principal,
        interestRate: '0',
        dueDate: addMonths(start, index + 1),
        note: null,
      })))
    }
    setEditing(true)
  }

  const applyPreset = (count: number) => {
    const start = localDate(new Date())
    setRows(splitPrincipal(invoiceTotal, count).map((principal, index) => ({
      principalAmount: principal,
      interestRate: '0',
      dueDate: addMonths(start, index + 1),
      note: null,
    })))
  }

  const updateRow = (index: number, changes: Partial<PlanItem>) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row))
  }

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    const result = await runMutation({
      context: { invoiceId: invoice.id },
      mutationPayload: { installments: rows },
      operation: () => withScopedApiRequestHeaders(
        buildOptimisticLockHeader(invoice.updatedAt),
        () => apiCall(`/api/invoice/invoices/${invoice.id}/installments`, {
          method: 'PUT',
          body: JSON.stringify({ installments: rows.map((item) => ({
            principalAmount: item.principalAmount,
            interestRate: Number(item.interestRate || 0),
            dueDate: item.dueDate,
            note: item.note || null,
          })) }),
        }),
      ),
    })
    setBusy(false)
    if (!result.ok) flash(t('invoice.errors.request_failed'), 'error')
    if (result.ok) {
      setEditing(false)
      onChanged()
      await refreshInvoice()
    }
  }

  const setStatus = async (item: PlanItem, paid: boolean) => {
    if (!item.id) return
    setBusy(true)
    const result = await runMutation({
      context: { invoiceId: invoice.id, installmentId: item.id },
      mutationPayload: { paid },
      operation: () => withScopedApiRequestHeaders(
        buildOptimisticLockHeader(invoice.updatedAt),
        () => apiCall(`/api/invoice/invoices/${invoice.id}/installments/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ paid }),
        }),
      ),
    })
    setBusy(false)
    if (result.ok) {
      onChanged()
      await refreshInvoice()
    }
  }

  const markAll = async (settled: boolean) => {
    const accepted = await confirm({
      title: settled
        ? t('invoice.installments.confirmMarkAll', 'Mark all installments as received?')
        : t('invoice.installments.confirmUnmarkAll', 'Unmark all installments?'),
      variant: settled ? 'default' : 'destructive',
    })
    if (!accepted) return
    setBusy(true)
    const result = await runMutation({
      context: { invoiceId: invoice.id },
      mutationPayload: { settled },
      operation: () => withScopedApiRequestHeaders(
        buildOptimisticLockHeader(invoice.updatedAt),
        () => apiCall(`/api/invoice/invoices/${invoice.id}/settlement`, {
          method: 'PATCH',
          body: JSON.stringify({ settled }),
        }),
      ),
    })
    setBusy(false)
    if (result.ok) {
      onChanged()
      onClose()
    }
  }

  const remove = async () => {
    const accepted = await confirm({
      title: t('invoice.installments.confirmRemove', 'Remove installment plan?'),
      text: t('invoice.installments.confirmRemoveDescription', 'The invoice will remain, but its payment schedule will be deleted.'),
      variant: 'destructive',
    })
    if (!accepted) return
    setBusy(true)
    const result = await runMutation({
      context: { invoiceId: invoice.id },
      mutationPayload: { id: invoice.id },
      operation: () => withScopedApiRequestHeaders(
        buildOptimisticLockHeader(invoice.updatedAt),
        () => apiCall(`/api/invoice/invoices/${invoice.id}/installments`, { method: 'DELETE' }),
      ),
    })
    setBusy(false)
    if (result.ok) {
      onChanged()
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="xl" style={bounds} className="min-w-0" onKeyDown={(event) => { if (editing && (event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (!busy) void save() } }}>
        <DialogHeader>
          <DialogTitle>{t('invoice.list.installments.title', 'Payments & Installments')}</DialogTitle>
          <p className="text-sm text-muted-foreground">{[invoice.invoiceSymbol, invoice.invoiceNumber, invoice.partnerName, invoice.currencyCode].filter(Boolean).join(' · ')}</p>
        </DialogHeader>

        <div className="flex flex-col gap-8">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            [t('invoice.installments.summary.total', 'Total'), invoice.grossAmount],
            [t('invoice.installments.summary.received', 'Received'), invoice.paidAmount],
            [t('invoice.installments.summary.outstanding', 'Outstanding'), invoice.outstandingAmount],
          ].map(([label, value], index) => (
            <div key={label} className={`min-w-0 py-2 ${index === 1 ? 'sm:text-center' : index === 2 ? 'sm:text-right' : ''}`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-semibold">{money(value)} {invoice.currencyCode}</p>
            </div>
          ))}
        </div>

        {editing ? (
          <div className="flex flex-col gap-6">
            <div className="rounded-xl border border-border bg-surface-muted p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{t('invoice.installments.splitPrincipal', 'Split principal equally')}</span>
                {[2, 3, 4, 6, 12].map((count) => <Button key={count} type="button" variant={rows.length === count ? 'secondary' : 'outline'} size="sm" onClick={() => applyPreset(count)}>{count}×</Button>)}
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-full text-sm">
                <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground"><tr>{['#', t('invoice.installments.columns.principal'), t('invoice.installments.columns.interestRate'), t('invoice.installments.columns.dueDate'), t('invoice.installments.columns.note'), ''].map((label) => <th key={label} className="px-3 py-3 font-semibold">{label}</th>)}</tr></thead>
                <tbody>{rows.map((item, index) => <tr key={item.id ?? index} className="border-t border-border align-middle">
                  <td className="px-3 py-3 font-medium">#{index + 1}</td>
                  <td className="px-3 py-3"><Input value={item.principalAmount} onChange={(event) => updateRow(index, { principalAmount: event.target.value })} aria-label={`${t('invoice.installments.columns.principal')} ${index + 1}`} /></td>
                  <td className="w-32 px-3 py-3"><Input type="number" min="0" max="100" step="0.0001" value={item.interestRate} onChange={(event) => updateRow(index, { interestRate: event.target.value })} aria-label={`${t('invoice.installments.columns.interestRate')} ${index + 1}`} /></td>
                  <td className="w-48 px-3 py-3"><Input type="date" value={dateValue(item.dueDate)} onChange={(event) => updateRow(index, { dueDate: event.target.value })} aria-label={`${t('invoice.installments.columns.dueDate')} ${index + 1}`} /></td>
                  <td className="px-3 py-3"><Input value={item.note ?? ''} onChange={(event) => updateRow(index, { note: event.target.value })} aria-label={`${t('invoice.installments.columns.note')} ${index + 1}`} /></td>
                  <td className="px-3 py-3"><IconButton type="button" variant="ghost" aria-label={t('invoice.installments.delete', 'Delete installment')} disabled={rows.length <= 2} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2 /></IconButton></td>
                </tr>)}</tbody>
              </table>
            </div>

            <Button type="button" variant="ghost" onClick={() => setRows((current) => [...current, { principalAmount: '0', interestRate: '0', dueDate: null, note: null }])}><Plus /> {t('invoice.installments.add', 'Add installment')}</Button>

            <div className="grid gap-3 rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm sm:grid-cols-3">
              <p>{t('invoice.installments.summary.principal', 'Principal')}: <strong>{money(principalTotal)} / {money(invoiceTotal)} {invoice.currencyCode}</strong></p>
              <p>{t('invoice.installments.summary.interest', 'Interest')}: <strong>{money(interestTotal)} {invoice.currencyCode}</strong></p>
              <p className={principalMatchesTotal ? 'text-status-success-text' : 'text-status-error-text'}>{principalMatchesTotal ? t('invoice.installments.matchesTotal', 'Matches total') : t('invoice.installments.doesNotMatchTotal', 'Does not match total')}</p>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>{t('common.cancel', 'Cancel')}</Button>
              <Button type="button" disabled={busy || !canSave} onClick={() => void save()}>{t('invoice.installments.save', 'Save plan')}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {hasPlan ? <div className="flex flex-col gap-3">
              {invoice.installments.map((item, index) => <div key={item.id ?? index} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4">
                <div className="min-w-0">
                  <p className="font-medium">#{item.sequence ?? index + 1} · {money(item.totalAmount ?? item.principalAmount)} {invoice.currencyCode}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t('invoice.installments.columns.dueDate')}: {item.dueDate ? new Date(item.dueDate).toLocaleDateString() : '—'}</p>
                  {Number(item.interestAmount) > 0 && <p className="mt-1 text-xs text-muted-foreground">{t('invoice.installments.summary.interest')}: {money(item.interestAmount)} {invoice.currencyCode}</p>}
                  {item.note && <p className="mt-1 break-words text-sm text-muted-foreground">{item.note}</p>}
                </div>
                <Button type="button" variant={item.status === 'PAID' ? 'secondary' : 'outline'} size="sm" className={item.status === 'PAID' ? 'rounded-full bg-status-success-bg text-status-success-text' : 'rounded-full'} disabled={busy} aria-label={item.status === 'PAID' ? t('invoice.installments.unmarkReceived') : t('invoice.installments.markReceived')} onClick={() => void setStatus(item, item.status !== 'PAID')}>
                  {item.status === 'PAID' && <Check className="size-4" />}{t(item.status === 'PAID' ? 'invoice.installments.received' : 'invoice.installments.markReceived')}
                </Button>
              </div>)}
            </div> : <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center"><p className="text-sm text-muted-foreground">{t('invoice.installments.empty', 'No installment plan has been created.')}</p></div>}

            <div className="flex w-full flex-wrap justify-end gap-2" style={{ justifyContent: 'flex-end' }}>
              <Button type="button" disabled={busy || !hasPlan} onClick={() => void markAll(!invoice.installments.every((item) => item.status === 'PAID'))}>{invoice.installments.every((item) => item.status === 'PAID') ? t('invoice.installments.unmarkAll', 'Unmark all') : t('invoice.installments.markAll', 'Mark all received')}</Button>
              <Button type="button" variant="outline" disabled={busy || hasPaidInstallment} onClick={startEdit}>{hasPlan ? t('invoice.installments.edit', 'Edit plan') : t('invoice.installments.set', 'Set installment plan')}</Button>
              <Button type="button" variant="destructive" disabled={busy || !hasPlan || hasPaidInstallment} onClick={() => void remove()}>{t('invoice.installments.remove', 'Remove plan')}</Button>
            </div>
          </div>
        )}
        </div>
      </DialogContent>
      {ConfirmDialogElement}
    </Dialog>
  )
}
