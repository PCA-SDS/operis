'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { LineChart, PieChart } from '@open-mercato/ui/backend/charts'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Direction = { outstandingAmount: string }
type Summary = { ar: Direction; ap: Direction; netPosition: string; ratesStale: boolean }
type Forecast = { ratesStale: boolean; series: Array<{ date: string; arAmount: string; apAmount: string; netAmount: string }>; totals: { netAmount: string } }
type Invoice = { direction: 'AR' | 'AP'; settlementStatus: string | null }
type InvoiceList = { items?: Invoice[]; data?: Invoice[] }

function Amount({ value }: { value: string }) { return <span>{Number(value).toLocaleString('vi-VN')} ₫</span> }
function Card({ title, value, caption }: { title: string; value: string; caption: string }) { return <div className="rounded-xl border border-border bg-surface p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p><p className="mt-4 text-3xl font-normal"><Amount value={value} /></p><p className="mt-2 text-sm text-muted-foreground">{caption}</p></div> }
function StatusCard({ title, subtitle, invoices, emptyMessage, t }: { title: string; subtitle: string; invoices: Invoice[]; emptyMessage: string; t: ReturnType<typeof useT> }) {
  const counts = { SETTLED: 0, PARTIALLY_PAID: 0, UNSETTLED: 0 }
  invoices.forEach((invoice) => { const status = invoice.settlementStatus === 'SETTLED' || invoice.settlementStatus === 'PARTIALLY_PAID' ? invoice.settlementStatus : 'UNSETTLED'; counts[status] += 1 })
  const data = [{ name: t('invoice.dashboard.settled'), value: counts.SETTLED }, { name: t('invoice.dashboard.partiallyPaid'), value: counts.PARTIALLY_PAID }, { name: t('invoice.dashboard.unsettled'), value: counts.UNSETTLED }]
  return <div className="rounded-xl border border-border bg-surface p-5 shadow-sm"><h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>{invoices.length === 0 ? <div className="mt-5 flex min-h-44 items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">{emptyMessage}</div> : <PieChart className="mt-3" data={data} variant="donut" showLabel emptyMessage={emptyMessage} />}</div>
}

export default function InvoiceDashboardPage() {
  const t = useT()
  const [horizon, setHorizon] = React.useState(30)
  const [invoices, setInvoices] = React.useState<Invoice[]>([])
  const [summary, setSummary] = React.useState<Summary | null>(null)
  const [forecast, setForecast] = React.useState<Forecast | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(false)
  const load = React.useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const throughDate = horizon === 0 ? '' : `?throughDate=${new Date(Date.now() + horizon * 86400000).toISOString().slice(0, 10)}`
      const [summaryCall, forecastCall, listCall] = await Promise.all([
        apiCall<Summary>('/api/invoice/summary'),
        apiCall<Forecast>(`/api/invoice/forecast${throughDate}`),
        apiCall<InvoiceList>('/api/invoice/invoices?pageSize=100'),
      ])
      if (!summaryCall.ok || !forecastCall.ok || !summaryCall.result || !forecastCall.result) throw new Error('[internal] invoice dashboard load failed')
      setSummary(summaryCall.result); setForecast(forecastCall.result); setInvoices(listCall.result?.items ?? listCall.result?.data ?? [])
    } catch { setError(true) } finally { setLoading(false) }
  }, [horizon])
  React.useEffect(() => { void load() }, [load])
  if (loading) return <Page><PageBody><LoadingMessage label={t('invoice.dashboard.loading')} /></PageBody></Page>
  if (error || !summary || !forecast) return <Page><PageBody><ErrorMessage label={t('invoice.dashboard.error')} action={<Button type="button" onClick={() => void load()}>{t('invoice.actions.retry')}</Button>} /></PageBody></Page>
  const chartData = forecast.series.map((point) => ({ date: point.date, arAmount: point.arAmount, apAmount: point.apAmount, netAmount: point.netAmount }))
  return <Page><PageBody className="space-y-5">
    <div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-normal">{t('invoice.dashboard.title')}</h1><p className="text-sm text-muted-foreground">{t('invoice.dashboard.subtitle')}</p></div><Button type="button">↻ {t('invoice.dashboard.sync')}</Button></div><h2 className="text-lg font-medium">{t('invoice.dashboard.overview')}</h2>
    {summary.ratesStale || forecast.ratesStale ? <p className="rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-2 text-sm text-status-warning-text">{t('invoice.dashboard.staleRates')}</p> : null}
    <div className="grid gap-4 sm:grid-cols-3"><Card title={t('invoice.dashboard.apOutstanding')} value={summary.ap.outstandingAmount} caption={t('invoice.dashboard.payablesCaption')} /><Card title={t('invoice.dashboard.arOutstanding')} value={summary.ar.outstandingAmount} caption={t('invoice.dashboard.receivablesCaption')} /><Card title={t('invoice.dashboard.netPosition')} value={summary.netPosition} caption={t('invoice.dashboard.netCaption')} /></div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]"><section className="rounded-xl border border-border bg-surface p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold uppercase tracking-wide">{t('invoice.dashboard.forecast')}</h2><div className="flex gap-1 rounded-md border border-border p-1">{[[7,'1W'],[30,'1M'],[0,'Max']].map(([value,label]) => <button key={label} type="button" className={`rounded px-2 py-1 text-xs ${horizon === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`} onClick={() => setHorizon(value as number)}>{label}</button>)}</div></div><p className="mt-3 text-2xl text-primary"><Amount value={forecast.totals.netAmount} /></p><LineChart className="mt-3" data={chartData} index="date" categories={['arAmount', 'apAmount', 'netAmount']} categoryLabels={{ arAmount: t('invoice.dashboard.ar'), apAmount: t('invoice.dashboard.ap'), netAmount: t('invoice.dashboard.net') }} valueFormatter={(value) => `${value.toLocaleString('vi-VN')} ₫`} emptyMessage={t('invoice.dashboard.noForecast')} /></section><div className="space-y-4"><StatusCard title={t('invoice.dashboard.receivablesStatus')} subtitle={t('invoice.dashboard.receivablesStatusSubtitle')} invoices={invoices.filter((invoice) => invoice.direction === 'AR')} emptyMessage={t('invoice.dashboard.noReceivables')} t={t} /><StatusCard title={t('invoice.dashboard.payablesStatus')} subtitle={t('invoice.dashboard.payablesStatusSubtitle')} invoices={invoices.filter((invoice) => invoice.direction === 'AP')} emptyMessage={t('invoice.dashboard.noPayables')} t={t} /></div></div>
  </PageBody></Page>
}
