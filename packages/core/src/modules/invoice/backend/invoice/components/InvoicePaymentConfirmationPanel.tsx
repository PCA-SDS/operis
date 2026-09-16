'use client'

import * as React from 'react'
import { CheckCircle2, CircleDollarSign, Mail, XCircle } from 'lucide-react'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useInvoiceT as useT } from '@open-mercato/core/modules/invoice/lib/useInvoiceT'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'

export type PaymentConfirmationView = {
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED'
  expiresAt: string
}

export type PaymentConfirmationState = {
  wholeInvoice: PaymentConfirmationView | null
  installments: Record<string, PaymentConfirmationView>
  incoming: { confirmationId: string; payerName: string | null; amount: string; currencyCode: string } | null
}

type Invoice = {
  id: string
  updatedAt?: string | null
  direction: 'AP' | 'AR'
  companyId: string | null
  partnerName: string | null
  invoiceSymbol: string | null
  invoiceNumber: string | null
  settlementStatus: string | null
  currencyCode?: string | null
  installments?: Array<{ id: string; sequence: number; totalAmount: string; status: string }>
  paymentConfirmation?: PaymentConfirmationState
}

type CompanyEmail = { id: string; email: string }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function InvoicePaymentConfirmationPanel({ invoice, onChanged }: { invoice: Invoice; onChanged: () => Promise<void> }) {
  const t = useT()
  const { payload, isReady } = useBackendChrome()
  const canManage = isReady && (!payload || hasFeature(payload.grantedFeatures, 'invoice.payment_confirmations.manage'))
  const [open, setOpen] = React.useState(false)
  const [target, setTarget] = React.useState<{ id: string | null; label: string } | null>(null)
  const [email, setEmail] = React.useState('')
  const [emails, setEmails] = React.useState<CompanyEmail[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [loadingEmails, setLoadingEmails] = React.useState(false)
  const formRef = React.useRef<HTMLFormElement>(null)
  const { runMutation, retryLastMutation, isPending } = useGuardedMutation({ contextId: 'invoice.detail.payment-confirmation' })

  const loadEmails = React.useCallback(async () => {
    if (!invoice.companyId) return
    setLoadingEmails(true)
    const call = await apiCall<{ items: CompanyEmail[] }>(
      `/api/invoice/company-emails?companyId=${encodeURIComponent(invoice.companyId)}`,
      undefined,
      { fallback: { items: [] } },
    )
    setEmails(call.ok ? call.result?.items ?? [] : [])
    if (!call.ok) setError(t('invoice.paymentConfirmation.recipientsLoadFailed'))
    setLoadingEmails(false)
  }, [invoice.companyId, t])

  React.useEffect(() => { if (open) void loadEmails() }, [loadEmails, open])

  const startRequest = (id: string | null, label: string) => {
    setTarget({ id, label })
    setEmail('')
    setError(null)
    setOpen(true)
  }

  const submit = React.useCallback(async () => {
    const typed = formRef.current?.querySelector<HTMLInputElement>('[role="combobox"]')?.value
    const recipientEmail = (typed ?? email).trim()
    if (!EMAIL_PATTERN.test(recipientEmail)) {
      setError(t('invoice.paymentConfirmation.invalidRecipient'))
      return
    }
    setError(null)
    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall<{ ok: true }>(
            '/api/invoice/payment-confirmations',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                invoiceId: invoice.id,
                recipientEmail,
                ...(target?.id ? { installmentId: target.id } : {}),
              }),
            },
            { fallback: null },
          )
          if (!call.ok) throw new Error(t('invoice.paymentConfirmation.requestFailed'))
          return call.result
        },
        context: { invoiceId: invoice.id, installmentId: target?.id, retryLastMutation },
        mutationPayload: { invoiceId: invoice.id, installmentId: target?.id },
      })
      flash(t('invoice.paymentConfirmation.requestSent'), 'success')
      setOpen(false)
      await onChanged()
    } catch {
      setError(t('invoice.paymentConfirmation.requestFailed'))
    }
  }, [email, invoice.id, onChanged, retryLastMutation, runMutation, t, target?.id])

  if (!canManage || invoice.direction !== 'AP' || invoice.settlementStatus === 'SETTLED') return null
  const current = invoice.paymentConfirmation?.wholeInvoice

  return (
    <>
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('invoice.paymentConfirmation.sectionTitle')}</h2>
        <div className="mt-3 space-y-3">
          {current ? <Badge variant={current.status === 'PENDING' ? 'warning' : 'neutral'}>{t(`invoice.paymentConfirmation.status.${current.status.toLowerCase()}`)}</Badge> : null}
          <p className="text-sm text-muted-foreground">{t('invoice.paymentConfirmation.requestDescription')}</p>
          <Button type="button" className="w-full" onClick={() => startRequest(null, t('invoice.paymentConfirmation.wholeInvoice'))}>
            <Mail className="size-4" aria-hidden="true" />
            {current?.status === 'PENDING' ? t('invoice.paymentConfirmation.resendAction') : t('invoice.paymentConfirmation.requestAction')}
          </Button>
          {invoice.installments?.filter((item) => item.status !== 'PAID').map((item) => {
            const installmentState = invoice.paymentConfirmation?.installments[item.id]
            return (
              <div key={item.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span>{t('invoice.paymentConfirmation.installmentLabel', { sequence: item.sequence })}</span>
                  {installmentState ? <Badge variant={installmentState.status === 'PENDING' ? 'warning' : 'neutral'}>{t(`invoice.paymentConfirmation.status.${installmentState.status.toLowerCase()}`)}</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{item.totalAmount} {invoice.currencyCode ?? ''}</p>
                <Button type="button" variant="outline" size="sm" className="mt-2 w-full" onClick={() => startRequest(item.id, t('invoice.paymentConfirmation.installmentLabel', { sequence: item.sequence }))}>
                  {installmentState?.status === 'PENDING' ? t('invoice.paymentConfirmation.resendAction') : t('invoice.paymentConfirmation.requestAction')}
                </Button>
              </div>
            )
          })}
        </div>
      </section>

      <Dialog open={open} onOpenChange={(next) => { if (!isPending) setOpen(next) }}>
        <DialogContent dismissible={!isPending}>
          <DialogHeader leading={<CircleDollarSign className="size-5" aria-hidden="true" />}>
            <DialogTitle>{t('invoice.paymentConfirmation.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('invoice.paymentConfirmation.dialogDescription', { target: target?.label ?? '' })}</DialogDescription>
          </DialogHeader>
          <form ref={formRef} className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit() }} onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (!isPending) void submit() }
          }}>
            <Label className="flex-col items-stretch gap-1.5">
              <span>{t('invoice.paymentConfirmation.recipientLabel')}</span>
              <ComboboxInput value={email} onChange={(value) => { setEmail(value); setError(null) }} suggestions={emails.map((item) => ({ value: item.email, label: item.email }))} placeholder={t('invoice.paymentConfirmation.recipientPlaceholder')} allowCustomValues autoFocus disabled={isPending} />
            </Label>
            {loadingEmails ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner size="sm" />{t('invoice.paymentConfirmation.recipientsLoading')}</p> : null}
            {error ? <Alert status="error" style="lighter">{error}</Alert> : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={isPending} onClick={() => setOpen(false)}>{t('invoice.paymentConfirmation.cancelAction')}</Button>
              <Button type="submit" disabled={isPending}>{isPending ? <Spinner size="sm" /> : <Mail className="size-4" aria-hidden="true" />}{t('invoice.paymentConfirmation.sendAction')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function IncomingPaymentConfirmationPanel({ invoice, onChanged }: { invoice: Invoice; onChanged: () => Promise<void> }) {
  const t = useT()
  const { payload, isReady } = useBackendChrome()
  const canManage = isReady && (!payload || hasFeature(payload.grantedFeatures, 'invoice.payment_confirmations.manage'))
  const incoming = invoice.paymentConfirmation?.incoming
  const { runMutation, retryLastMutation, isPending } = useGuardedMutation({ contextId: 'invoice.detail.incoming-payment-confirmation' })
  const [error, setError] = React.useState<string | null>(null)
  if (!canManage || invoice.direction !== 'AR' || !incoming) return null

  const transition = async (action: 'accept' | 'reject') => {
    setError(null)
    try {
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(invoice.updatedAt),
            () => apiCall<{ ok: true }>(`/api/invoice/invoices/${encodeURIComponent(invoice.id)}/incoming-confirmation/${action}`, { method: 'POST' }, { fallback: null }),
          )
          if (!call.ok) throw new Error(t('invoice.paymentConfirmation.incomingFailed'))
          return call.result
        },
        context: { invoiceId: invoice.id, confirmationId: incoming.confirmationId, retryLastMutation },
        mutationPayload: { invoiceId: invoice.id },
      })
      flash(t(action === 'accept' ? 'invoice.paymentConfirmation.incomingAccepted' : 'invoice.paymentConfirmation.incomingRejected'), 'success')
      await onChanged()
    } catch {
      setError(t('invoice.paymentConfirmation.incomingFailed'))
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('invoice.paymentConfirmation.incomingTitle')}</h2>
      <p className="mt-3 text-sm">{t('invoice.paymentConfirmation.incomingDescription', { payer: incoming.payerName ?? t('invoice.paymentConfirmation.payerFallback'), amount: `${incoming.amount} ${incoming.currencyCode}` })}</p>
      {error ? <Alert className="mt-3" status="error" style="lighter">{error}</Alert> : null}
      <div className="mt-4 grid gap-2">
        <Button type="button" disabled={isPending} onClick={() => void transition('accept')}><CheckCircle2 className="size-4" aria-hidden="true" />{t('invoice.paymentConfirmation.acceptAction')}</Button>
        <Button type="button" variant="outline" disabled={isPending} onClick={() => void transition('reject')}><XCircle className="size-4" aria-hidden="true" />{t('invoice.paymentConfirmation.rejectAction')}</Button>
      </div>
    </section>
  )
}
