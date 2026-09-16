'use client'

import * as React from 'react'
import { CheckCircle2, CircleAlert, CircleDollarSign, XCircle } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type Preview = {
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED'
  expiresAt: string
  payerName: string | null
  payeeName: string | null
  invoice: { symbol: string | null; number: string; amount: string; currencyCode: string }
  installment: { sequence: number; amount: string; dueDate: string } | null
}

type PageState = 'loading' | 'ready' | 'invalid' | 'rateLimited' | 'error'

export default function PaymentConfirmationPublicPage({ params }: { params: { token?: string } }) {
  const t = useT()
  const token = params?.token
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [state, setState] = React.useState<PageState>('loading')
  const [busy, setBusy] = React.useState<'confirm' | 'reject' | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!token) { setState('invalid'); return }
    setState('loading')
    const call = await apiCall<Preview>(
      `/api/invoice/payment-confirmations/public/${encodeURIComponent(token)}`,
      undefined,
      { fallback: null },
    )
    if (call.ok && call.result) { setPreview(call.result); setState('ready'); return }
    if (call.status === 404) setState('invalid')
    else if (call.status === 429) setState('rateLimited')
    else setState('error')
  }, [token])

  React.useEffect(() => { void load() }, [load])

  const transition = async (action: 'confirm' | 'reject') => {
    if (!token) return
    setBusy(action)
    setActionError(null)
    const call = await apiCall<{ status: Preview['status'] }>(
      `/api/invoice/payment-confirmations/public/${encodeURIComponent(token)}/${action}`,
      { method: 'POST' },
      { fallback: null },
    )
    if (call.ok || call.status === 409 || call.status === 410) await load()
    else if (call.status === 429) setState('rateLimited')
    else setActionError(t('invoice.paymentConfirmation.public.actionFailed'))
    setBusy(null)
  }

  if (state === 'loading') return <PublicFrame><Spinner /><p>{t('invoice.paymentConfirmation.public.loading')}</p></PublicFrame>
  if (state === 'invalid') return <PublicFrame icon={<CircleAlert className="size-10" />} title={t('invoice.paymentConfirmation.public.invalidTitle')}><p>{t('invoice.paymentConfirmation.public.invalidDescription')}</p></PublicFrame>
  if (state === 'rateLimited') return <PublicFrame icon={<CircleAlert className="size-10" />} title={t('invoice.paymentConfirmation.public.rateLimitTitle')}><p>{t('invoice.paymentConfirmation.public.rateLimitDescription')}</p></PublicFrame>
  if (state === 'error' || !preview) return <PublicFrame icon={<CircleAlert className="size-10" />} title={t('invoice.paymentConfirmation.public.errorTitle')}><p>{t('invoice.paymentConfirmation.public.errorDescription')}</p><Button type="button" onClick={() => void load()}>{t('invoice.actions.retry')}</Button></PublicFrame>

  const expired = preview.status === 'PENDING' && new Date(preview.expiresAt) <= new Date()
  const label = [preview.invoice.symbol, preview.invoice.number].filter(Boolean).join(' · ')
  const amount = preview.installment?.amount ?? preview.invoice.amount
  if (preview.status === 'CONFIRMED') return <PublicFrame icon={<CheckCircle2 className="size-10 text-status-success-icon" />} title={t('invoice.paymentConfirmation.public.confirmedTitle')}><p>{t('invoice.paymentConfirmation.public.confirmedDescription', { amount: `${amount} ${preview.invoice.currencyCode}`, payer: preview.payerName ?? t('invoice.paymentConfirmation.payerFallback'), invoice: label })}</p></PublicFrame>
  if (preview.status === 'REJECTED') return <PublicFrame icon={<XCircle className="size-10 text-status-error-icon" />} title={t('invoice.paymentConfirmation.public.rejectedTitle')}><p>{t('invoice.paymentConfirmation.public.rejectedDescription')}</p></PublicFrame>
  if (expired) return <PublicFrame icon={<CircleAlert className="size-10" />} title={t('invoice.paymentConfirmation.public.expiredTitle')}><p>{t('invoice.paymentConfirmation.public.expiredDescription')}</p></PublicFrame>

  return (
    <PublicFrame icon={<CircleDollarSign className="size-10" />} title={t('invoice.paymentConfirmation.public.questionTitle')}>
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>{t('invoice.paymentConfirmation.public.questionDescription', { payer: preview.payerName ?? t('invoice.paymentConfirmation.payerFallback'), amount: `${amount} ${preview.invoice.currencyCode}`, invoice: label })}</p>
        {preview.installment ? <p>{t('invoice.paymentConfirmation.public.installment', { sequence: preview.installment.sequence })}</p> : null}
      </div>
      {actionError ? <Alert status="error" style="lighter">{actionError}</Alert> : null}
      <Button type="button" className="w-full" disabled={Boolean(busy)} onClick={() => void transition('confirm')}>{busy === 'confirm' ? <Spinner size="sm" /> : <CheckCircle2 className="size-4" />}{t('invoice.paymentConfirmation.public.confirmAction')}</Button>
      <Button type="button" className="w-full" variant="outline" disabled={Boolean(busy)} onClick={() => void transition('reject')}>{busy === 'reject' ? <Spinner size="sm" /> : <XCircle className="size-4" />}{t('invoice.paymentConfirmation.public.rejectAction')}</Button>
      <p className="text-xs text-muted-foreground">{t('invoice.paymentConfirmation.public.safetyNote')}</p>
    </PublicFrame>
  )
}

function PublicFrame({ icon, title, children }: { icon?: React.ReactNode; title?: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <section className="w-full max-w-lg space-y-5 rounded-xl border border-border bg-surface p-6 text-center shadow-sm">
        {icon ? <div className="flex justify-center">{icon}</div> : null}
        {title ? <h1 className="text-2xl font-semibold text-foreground">{title}</h1> : null}
        {children}
      </section>
    </main>
  )
}
