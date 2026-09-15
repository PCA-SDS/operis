'use client'

import * as React from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { useInvoiceT as useT } from '@open-mercato/core/modules/invoice/lib/useInvoiceT'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Button } from '@open-mercato/ui/primitives/button'
import { InvoiceSendPanel } from '../../components/InvoiceSendPanel'
import {
  IncomingPaymentConfirmationPanel,
  InvoicePaymentConfirmationPanel,
  type PaymentConfirmationState,
} from '../../components/InvoicePaymentConfirmationPanel'

type Invoice = {
  id: string
  invoiceSymbol: string | null
  invoiceNumber: string | null
  direction: 'AP' | 'AR'
  companyId: string | null
  partnerName: string | null
  partnerTaxCode: string | null
  sellerName: string | null
  sellerTaxCode: string | null
  buyerName: string | null
  buyerTaxCode: string | null
  invoiceDate: string | null
  dueDate: string | null
  currencyCode: string | null
  grossAmount: string | null
  outstandingAmount: string | null
  settlementStatus: string | null
  origin: string | null
  netAmount: string | null
  vatAmount: string | null
  paidAmount: string | null
  nonRecoverable: boolean
  autoSettled: boolean
  hasInstallmentPlan: boolean
  lastSentAt: string | null
  openedAt: string | null
  updatedAt: string | null
  lineItems: Array<{ id: string; lineNumber: number; name: string; quantity: string | null; unitPrice: string | null; vatRate: string | null; lineTotal: string }>
  installments: Array<{ id: string; sequence: number; principalAmount: string; interestAmount: string; totalAmount: string; dueDate: string | null; status: string }>
  paymentConfirmation?: PaymentConfirmationState
}

type DetailState = 'loading' | 'error' | 'notFound' | 'ready'

function displayDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : '—'
}

function displayMoney(value: string | null, currency: string | null) {
  return value ? `${value} ${currency ?? ''}`.trim() : '—'
}

export default function InvoiceDetailPage() {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation, isPending: isReversingAutoPaid } = useGuardedMutation({ contextId: 'invoice.detail.reverse-auto-paid' })
  const router = useRouter()
  const params = useParams<{ id?: string }>()
  const pathname = usePathname()
  const id = params.id ?? pathname.split('/').filter(Boolean).at(-1)
  const [invoice, setInvoice] = React.useState<Invoice | null>(null)
  const [state, setState] = React.useState<DetailState>('loading')

  const load = React.useCallback(async () => {
    if (!id || id === 'edit') {
      setState('notFound')
      return
    }
    setState('loading')
    try {
      const call = await apiCall<Invoice>(
        `/api/invoice/invoices/${encodeURIComponent(id)}`,
        undefined,
        { fallback: null },
      )
      if (call.status === 404) {
        setInvoice(null)
        setState('notFound')
      } else if (!call.ok || !call.result) {
        setState('error')
      } else {
        setInvoice(call.result)
        setState('ready')
      }
    } catch {
      setState('error')
    }
  }, [id])

  React.useEffect(() => { void load() }, [load])

  const reverseAutoPaid = React.useCallback(async () => {
    if (!invoice) return
    const accepted = await confirm({
      title: t('invoice.detail.reverseAutoPaid.title'),
      text: t('invoice.detail.reverseAutoPaid.description'),
      confirmText: t('invoice.detail.reverseAutoPaid.confirm'),
      cancelText: t('invoice.settings.cancel'),
      variant: 'destructive',
    })
    if (!accepted) return
    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall<{ ok: true; reversed: true }>(
            `/api/invoice/invoices/${encodeURIComponent(invoice.id)}/reverse-auto-paid`,
            { method: 'PATCH' },
            { fallback: null },
          )
          if (!call.ok || !call.result?.ok) throw new Error(t('invoice.detail.reverseAutoPaid.failed'))
          return call.result
        },
        context: { invoiceId: invoice.id, resourceKind: 'invoice.invoice', retryLastMutation },
        mutationPayload: { invoiceId: invoice.id },
      })
      flash(t('invoice.detail.reverseAutoPaid.success'), 'success')
      await load()
    } catch {
      flash(t('invoice.detail.reverseAutoPaid.failed'), 'error')
    }
  }, [confirm, invoice, load, retryLastMutation, runMutation, t])

  if (state === 'loading') return <Page><PageBody><LoadingMessage label={t('invoice.detail.loading')} /></PageBody></Page>
  if (state === 'notFound') {
    return <Page><PageBody><ErrorMessage label={t('invoice.detail.notFound')} action={<Button type="button" onClick={() => router.push('/backend/invoice/all')}>{t('invoice.detail.backToList')}</Button>} /></PageBody></Page>
  }
  if (state === 'error' || !invoice) {
    return <Page><PageBody><ErrorMessage label={t('invoice.detail.error')} action={<Button type="button" onClick={() => void load()}>{t('invoice.actions.retry')}</Button>} /></PageBody></Page>
  }

  const label = [invoice.invoiceSymbol, invoice.invoiceNumber].filter(Boolean).join(' · ') || t('invoice.detail.untitled')
  const status = invoice.nonRecoverable
    ? t('invoice.detail.status.nonRecoverable')
    : invoice.settlementStatus === 'SETTLED'
      ? invoice.autoSettled ? t('invoice.detail.status.autoPaid') : t('invoice.detail.status.paid')
      : invoice.settlementStatus === 'PARTIALLY_PAID'
        ? t('invoice.detail.status.partiallyPaid')
        : t('invoice.detail.status.unpaid')
  const seller = invoice.sellerName ?? invoice.partnerName
  const buyer = invoice.buyerName ?? invoice.partnerName
  const currentCompanyIsSeller = invoice.direction === 'AR'
  const youLabel = t('invoice.detail.you', 'You')
  const sellerDisplayName = currentCompanyIsSeller ? `${seller ?? t('invoice.detail.untitled')} (${youLabel})` : seller
  const buyerDisplayName = currentCompanyIsSeller ? buyer : `${buyer ?? t('invoice.detail.untitled')} (${youLabel})`

  return (
    <Page>
      <PageBody className="space-y-5">
        <div className="space-y-2">
          <Button type="button" variant="ghost" onClick={() => router.push('/backend/invoice/all')}>← {t('invoice.detail.backToList')}</Button>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">{t('invoice.detail.invoicePrefix')} {label}</h1>
              <p className="text-sm text-muted-foreground">{t('invoice.detail.issuedOn')} {displayDate(invoice.invoiceDate)}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-surface px-3 py-1 text-sm">{status}</span>
              {invoice.direction === 'AP' && invoice.autoSettled ? <Button type="button" variant="outline" disabled={isReversingAutoPaid} onClick={() => void reverseAutoPaid()}>{t('invoice.detail.reverseAutoPaid.action')}</Button> : null}
              {invoice.origin === 'MANUAL' ? <Button type="button" variant="outline" onClick={() => router.push(`/backend/invoice/all/${invoice.id}/edit`)}>{t('invoice.detail.edit')}</Button> : null}
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,768px)_320px]">
          <section className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex justify-between border-b border-border p-6">
              <div><h2 className="font-semibold">{sellerDisplayName}</h2><p className="text-sm text-muted-foreground">{t('invoice.detail.taxCode', 'Tax code')}: {invoice.sellerTaxCode ?? invoice.partnerTaxCode ?? '—'}</p></div>
              <div className="text-right"><p className="text-sm text-muted-foreground">{label}</p><p className="text-xs text-muted-foreground">{t('invoice.detail.total')}</p><p className="text-2xl font-semibold">{displayMoney(invoice.grossAmount, invoice.currencyCode)}</p></div>
            </div>
            <div className="grid gap-5 border-b border-border p-6 sm:grid-cols-[220px_1fr]">
              <div className="rounded-xl bg-input-bg p-4">
                <p className="text-xs text-muted-foreground">{t('invoice.detail.issueDate')}</p><p>{displayDate(invoice.invoiceDate)}</p>
                <p className="mt-4 text-xs text-muted-foreground">{t('invoice.detail.dueDate')}</p><p>{displayDate(invoice.dueDate)}</p>
                <p className="mt-4 text-xs text-muted-foreground">{t('invoice.detail.source')}</p><p>{invoice.origin === 'MANUAL' ? t('invoice.detail.createdInApp') : t('invoice.detail.imported')}</p>
              </div>
              <div className="pt-0"><p className="text-xs text-muted-foreground">{t('invoice.detail.billTo')}</p><p className="font-semibold">{buyerDisplayName}</p><p className="text-sm text-muted-foreground">{t('invoice.detail.taxCode', 'Tax code')}: {invoice.buyerTaxCode ?? invoice.partnerTaxCode ?? '—'}</p></div>
            </div>
            <div className="overflow-x-auto p-6">
              <table className="w-full text-sm">
                <thead><tr className="bg-input-bg text-left"><th className="p-2">{t('invoice.detail.no')}</th><th className="p-2">{t('invoice.detail.description')}</th><th className="p-2">{t('invoice.detail.qty')}</th><th className="p-2">{t('invoice.detail.unitPrice')}</th><th className="p-2">{t('invoice.detail.vat')}</th><th className="p-2 text-right">{t('invoice.detail.amount')}</th></tr></thead>
                <tbody>{invoice.lineItems.map((item) => <tr key={item.id} className="border-b border-border"><td className="p-2">{item.lineNumber}</td><td className="p-2">{item.name}</td><td className="p-2">{item.quantity ?? '—'}</td><td className="p-2">{displayMoney(item.unitPrice, invoice.currencyCode)}</td><td className="p-2">{item.vatRate ?? '—'}</td><td className="p-2 text-right">{displayMoney(item.lineTotal, invoice.currencyCode)}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="ml-auto max-w-sm space-y-2 p-6 text-sm">
              <div className="flex justify-between"><span>{t('invoice.detail.subtotal')}</span><span>{displayMoney(invoice.netAmount, invoice.currencyCode)}</span></div>
              <div className="flex justify-between"><span>{t('invoice.detail.vat')}</span><span>{displayMoney(invoice.vatAmount, invoice.currencyCode)}</span></div>
              <div className="flex justify-between border-t border-border pt-2 font-semibold"><span>{t('invoice.detail.total')}</span><span>{displayMoney(invoice.grossAmount, invoice.currencyCode)}</span></div>
            </div>
            {invoice.hasInstallmentPlan && invoice.installments.length > 0 ? (
              <div className="border-t border-border p-6">
                <h2 className="mb-3 font-semibold">{t('invoice.detail.paymentSchedule')}</h2>
                <div className="space-y-2 text-sm">{invoice.installments.map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-2 border-b border-border py-2"><span>#{item.sequence} · {displayDate(item.dueDate)}</span><span>{displayMoney(item.totalAmount, invoice.currencyCode)} · {item.status}</span></div>)}</div>
              </div>
            ) : null}
          </section>

          <aside className="space-y-4 lg:sticky lg:top-5">
            {invoice.direction === 'AR' ? <InvoiceSendPanel invoice={invoice} onSent={load} /> : null}
            {invoice.direction === 'AP' ? <InvoicePaymentConfirmationPanel invoice={invoice} onChanged={load} /> : null}
            {invoice.direction === 'AR' ? <IncomingPaymentConfirmationPanel invoice={invoice} onChanged={load} /> : null}
            <section className="rounded-xl border border-border bg-surface p-5">
              <h2 className="border-b border-border pb-3 text-xs font-semibold text-muted-foreground">{t('invoice.detail.summary')}</h2>
              <div className="space-y-3 pt-4 text-sm">
                <div className="flex justify-between"><span>{t('invoice.detail.total')}</span><span>{displayMoney(invoice.grossAmount, invoice.currencyCode)}</span></div>
                <div className="flex justify-between font-semibold"><span>{t('invoice.detail.remaining')}</span><span>{displayMoney(invoice.outstandingAmount, invoice.currencyCode)}</span></div>
                {invoice.dueDate && invoice.settlementStatus !== 'SETTLED' ? <p className="pt-3 text-muted-foreground">{t('invoice.detail.nextPayment')} {displayDate(invoice.dueDate)}</p> : null}
              </div>
            </section>
          </aside>
        </div>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
