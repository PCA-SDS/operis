'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { LineChart } from '@open-mercato/ui/backend/charts'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Direction = { outstandingAmount: string; settledAmount: string; totalAmount: string }
type Summary = { currency: 'VND'; ar: Direction; ap: Direction; netPosition: string; netOutstanding: string; ratesStale: boolean }
type Forecast = { currency: 'VND'; ratesStale: boolean; series: Array<{ date: string; arAmount: string; apAmount: string; netAmount: string }>; totals: { arAmount: string; apAmount: string; netAmount: string } }

function Amount({ value }: { value: string }) { return <span>{value} VND</span> }
function Card({ title, value }: { title: string; value: string }) { return <div className="rounded-xl border border-border bg-surface p-4 shadow-sm"><p className="text-sm text-muted-foreground">{title}</p><p className="mt-2 text-xl font-medium"><Amount value={value} /></p></div> }

export default function InvoiceDashboardPage() {
  const t = useT()
  const [horizon, setHorizon] = React.useState(30)
  const [summary, setSummary] = React.useState<Summary | null>(null)
  const [forecast, setForecast] = React.useState<Forecast | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(false)
  const load = React.useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const throughDate = new Date(Date.now() + horizon * 86400000).toISOString().slice(0, 10)
      const [summaryCall, forecastCall] = await Promise.all([
        apiCall<Summary>('/api/invoice/summary'),
        apiCall<Forecast>(`/api/invoice/forecast?throughDate=${throughDate}`),
      ])
      if (!summaryCall.ok || !forecastCall.ok || !summaryCall.result || !forecastCall.result) throw new Error('[internal] invoice dashboard load failed')
      setSummary(summaryCall.result); setForecast(forecastCall.result)
    } catch { setError(true) } finally { setLoading(false) }
  }, [horizon])
  React.useEffect(() => { void load() }, [load])
  if (loading) return <Page><PageBody><LoadingMessage label={t('invoice.dashboard.loading')} /></PageBody></Page>
  if (error || !summary || !forecast) return <Page><PageBody><ErrorMessage label={t('invoice.dashboard.error')} action={<Button type="button" onClick={() => void load()}>{t('invoice.actions.retry')}</Button>} /></PageBody></Page>
  const chartData = forecast.series.map((point) => ({ date: point.date, arAmount: point.arAmount, apAmount: point.apAmount, netAmount: point.netAmount }))
  return <Page><PageBody className="space-y-5">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-normal">{t('invoice.dashboard.title')}</h1><p className="text-sm text-muted-foreground">{t('invoice.dashboard.subtitle')}</p></div><label className="flex items-center gap-2 text-sm">{t('invoice.dashboard.horizon')}<select className="rounded-md border border-border bg-input-bg px-3 py-2" value={horizon} onChange={(event) => setHorizon(Number(event.target.value))}><option value={30}>{t('invoice.dashboard.days', { count: 30 })}</option><option value={60}>{t('invoice.dashboard.days', { count: 60 })}</option><option value={90}>{t('invoice.dashboard.days', { count: 90 })}</option></select></label></div>
    {summary.ratesStale || forecast.ratesStale ? <p className="rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-2 text-sm text-status-warning-text">{t('invoice.dashboard.staleRates')}</p> : null}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Card title={t('invoice.dashboard.arOutstanding')} value={summary.ar.outstandingAmount} /><Card title={t('invoice.dashboard.apOutstanding')} value={summary.ap.outstandingAmount} /><Card title={t('invoice.dashboard.netOutstanding')} value={summary.netOutstanding} /><Card title={t('invoice.dashboard.forecastNet')} value={forecast.totals.netAmount} /></div>
    <LineChart title={t('invoice.dashboard.forecast')} data={chartData} index="date" categories={['arAmount', 'apAmount', 'netAmount']} categoryLabels={{ arAmount: t('invoice.dashboard.ar'), apAmount: t('invoice.dashboard.ap'), netAmount: t('invoice.dashboard.net') }} valueFormatter={(value) => `${value} VND`} emptyMessage={t('invoice.dashboard.noForecast')} />
  </PageBody></Page>
}
