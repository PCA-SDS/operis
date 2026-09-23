'use client'

import * as React from 'react'
import { CheckCircle2, CircleDollarSign, Mail, Trash2, XCircle } from 'lucide-react'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useInvoiceT as useT } from '../../../lib/useInvoiceT'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { formatInvoiceMoney } from '../../../lib/format'

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

type CompanyEmail = { id: string; companyId: string; email: string; updatedAt: string | null }

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
  const [emailListError, setEmailListError] = React.useState<string | null>(null)
  const [loadingEmails, setLoadingEmails] = React.useState(false)
  const [removingId, setRemovingId] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation, isPending } = useGuardedMutation({ contextId: 'invoice.detail.payment-confirmation' })
  const { runMutation: runEmailMutation, retryLastMutation: retryEmailMutation } = useGuardedMutation({
    contextId: 'invoice.detail.company-email.remove',
  })

  const loadEmails = React.useCallback(async () => {
    if (!invoice.companyId) {
      setEmails([])
      setEmailListError(null)
      return
    }
    setLoadingEmails(true)
    setEmailListError(null)
    try {
      const call = await apiCall<{ items: CompanyEmail[] }>(
        `/api/invoice/company-emails?companyId=${encodeURIComponent(invoice.companyId)}`,
        undefined,
        { fallback: { items: [] } },
      )
      if (!call.ok) {
        setEmails([])
        setEmailListError(t('invoice.paymentConfirmation.recipientsLoadFailed'))
        return
      }
      setEmails(call.result?.items ?? [])
    } catch {
      setEmails([])
      setEmailListError(t('invoice.paymentConfirmation.recipientsLoadFailed'))
    } finally {
      setLoadingEmails(false)
    }
  }, [invoice.companyId, t])

  React.useEffect(() => { if (open) void loadEmails() }, [loadEmails, open])

  const startRequest = (id: string | null, label: string) => {
    setTarget({ id, label })
    setEmail('')
    setError(null)
    setOpen(true)
  }

  const removeEmail = React.useCallback(async (entry: CompanyEmail) => {
    if (!invoice.companyId) return
    setRemovingId(entry.id)
    setEmailListError(null)
    try {
      await runEmailMutation({
        operation: async () => {
          const call = await apiCall<{ ok: true }>(
            `/api/invoice/company-emails/${encodeURIComponent(entry.id)}?companyId=${encodeURIComponent(invoice.companyId!)}`,
            { method: 'DELETE' },
            { fallback: null },
          )
          if (!call.ok) throw new Error(t('invoice.send.recipientRemoveFailed'))
          return call.result
        },
        context: { invoiceId: invoice.id, companyId: invoice.companyId, retryLastMutation: retryEmailMutation },
        mutationPayload: { companyId: invoice.companyId, emailId: entry.id },
      })
      setEmails((current) => current.filter((item) => item.id !== entry.id))
    } catch {
      setEmailListError(t('invoice.send.recipientRemoveFailed'))
    } finally {
      setRemovingId(null)
    }
  }, [invoice.companyId, invoice.id, retryEmailMutation, runEmailMutation, t])

  const submit = React.useCallback(async () => {
    const recipientEmail = email.trim()
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
                <p className="mt-1 text-sm text-muted-foreground">{formatInvoiceMoney(item.totalAmount, invoice.currencyCode)}</p>
                <Button type="button" variant="outline" size="sm" className="mt-2 w-full" onClick={() => startRequest(item.id, t('invoice.paymentConfirmation.installmentLabel', { sequence: item.sequence }))}>
                  {installmentState?.status === 'PENDING' ? t('invoice.paymentConfirmation.resendAction') : t('invoice.paymentConfirmation.requestAction')}
                </Button>
              </div>
            )
          })}
        </div>
      </section>

      <Dialog open={open} onOpenChange={(next) => { if (!isPending && !removingId) setOpen(next) }}>
        <DialogContent dismissible={!isPending && !removingId}>
          <DialogHeader leading={<CircleDollarSign className="size-5" aria-hidden="true" />}>
            <DialogTitle>{t('invoice.paymentConfirmation.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('invoice.paymentConfirmation.dialogDescription', { target: target?.label ?? '' })}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit() }} onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (!isPending) void submit() }
          }}>
            <Label className="flex-col items-stretch gap-1.5">
              <span>{t('invoice.paymentConfirmation.recipientLabel')}</span>
              <Input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(null) }} placeholder={t('invoice.paymentConfirmation.recipientPlaceholder')} autoFocus disabled={isPending || Boolean(removingId)} />
            </Label>
            {loadingEmails ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner size="sm" />{t('invoice.paymentConfirmation.recipientsLoading')}</p> : null}
            {!loadingEmails && invoice.companyId && emails.length > 0 ? (
              <div className="space-y-2 pt-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('invoice.send.rememberedRecipients', { company: invoice.partnerName ?? t('invoice.detail.untitled') })}
                </p>
                <ul className="space-y-1">
                  {emails.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-w-0 flex-1 truncate text-left text-sm text-foreground"
                        onClick={() => {
                          setEmail(item.email)
                          setError(null)
                        }}
                        disabled={isPending || Boolean(removingId)}
                      >
                        {item.email}
                      </Button>
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('invoice.send.removeRecipient', { email: item.email })}
                        title={t('invoice.send.removeRecipient', { email: item.email })}
                        disabled={isPending || Boolean(removingId)}
                        onClick={() => void removeEmail(item)}
                      >
                        {removingId === item.id ? <Spinner size="sm" /> : <Trash2 className="size-4" aria-hidden="true" />}
                      </IconButton>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {emailListError ? (
              <Alert
                status="warning"
                style="lighter"
                action={<Button type="button" variant="ghost" size="sm" onClick={() => void loadEmails()}>{t('invoice.actions.retry')}</Button>}
              >
                {emailListError}
              </Alert>
            ) : null}
            {error ? <Alert status="error" style="lighter">{error}</Alert> : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={isPending || Boolean(removingId)} onClick={() => setOpen(false)}>{t('invoice.paymentConfirmation.cancelAction')}</Button>
              <Button type="submit" disabled={isPending || Boolean(removingId)}>{isPending ? <Spinner size="sm" /> : <Mail className="size-4" aria-hidden="true" />}{t('invoice.paymentConfirmation.sendAction')}</Button>
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
      <p className="mt-3 text-sm">{t('invoice.paymentConfirmation.incomingDescription', { payer: incoming.payerName ?? t('invoice.paymentConfirmation.payerFallback'), amount: formatInvoiceMoney(incoming.amount, incoming.currencyCode) })}</p>
      {error ? <Alert className="mt-3" status="error" style="lighter">{error}</Alert> : null}
      <div className="mt-4 grid gap-2">
        <Button type="button" disabled={isPending} onClick={() => void transition('accept')}><CheckCircle2 className="size-4" aria-hidden="true" />{t('invoice.paymentConfirmation.acceptAction')}</Button>
        <Button type="button" variant="outline" disabled={isPending} onClick={() => void transition('reject')}><XCircle className="size-4" aria-hidden="true" />{t('invoice.paymentConfirmation.rejectAction')}</Button>
      </div>
    </section>
  )
}
