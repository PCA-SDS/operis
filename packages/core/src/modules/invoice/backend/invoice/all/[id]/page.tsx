'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Invoice = { invoiceNumber: string | null; direction: string; partnerName: string | null; invoiceDate: string | null; dueDate: string | null; currencyCode: string | null; grossAmount: string | null; outstandingAmount: string | null; settlementStatus: string | null; origin: string | null }
export default function InvoiceDetailPage() {
  const t = useT(); const { id } = useParams<{ id: string }>(); const [invoice, setInvoice] = React.useState<Invoice | null>(null); const [state, setState] = React.useState<'loading' | 'error' | 'notFound' | 'ready'>('loading')
  const load = React.useCallback(async () => { setState('loading'); const call = await apiCall<Invoice>(`/api/invoice/invoices/${id}`); if (call.status === 404) setState('notFound'); else if (!call.ok || !call.result) setState('error'); else { setInvoice(call.result); setState('ready') } }, [id])
  React.useEffect(() => { void load() }, [load])
  if (state === 'loading') return <Page><PageBody><LoadingMessage label={t('invoice.detail.loading')} /></PageBody></Page>
  if (state === 'notFound') return <Page><PageBody><ErrorMessage label={t('invoice.detail.notFound')} /></PageBody></Page>
  if (state === 'error' || !invoice) return <Page><PageBody><ErrorMessage label={t('invoice.detail.error')} action={<Button type="button" onClick={() => void load()}>{t('invoice.actions.retry')}</Button>} /></PageBody></Page>
  return <Page><PageBody className="space-y-5"><div><h1 className="text-2xl font-normal">{invoice.invoiceNumber ?? t('invoice.detail.untitled')}</h1><p className="text-sm text-muted-foreground">{invoice.direction} · {invoice.partnerName ?? '—'}</p></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[[t('invoice.list.columns.issueDate'), invoice.invoiceDate], [t('invoice.list.columns.dueDate'), invoice.dueDate], [t('invoice.list.columns.total'), invoice.grossAmount ? `${invoice.grossAmount} ${invoice.currencyCode ?? ''}` : '—'], [t('invoice.list.columns.outstanding'), invoice.outstandingAmount ? `${invoice.outstandingAmount} ${invoice.currencyCode ?? ''}` : '—'], [t('invoice.list.columns.settlement'), invoice.settlementStatus], [t('invoice.list.columns.origin'), invoice.origin]].map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-surface p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1">{value ?? '—'}</p></div>)}</div></PageBody></Page>
}
