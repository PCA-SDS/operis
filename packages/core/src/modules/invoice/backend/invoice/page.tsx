'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Slider } from '@open-mercato/ui/primitives/slider'
import { LineChart, PieChart } from '@open-mercato/ui/backend/charts'
import { useInvoiceT as useT } from '../../lib/useInvoiceT'
import { InvoiceSyncButton } from './components/InvoiceSyncButton'
import { formatInvoiceMoney } from '../../lib/format'
import type { InvoiceForecastDto, InvoiceSummaryDto } from '../../data/mappers'

type Invoice = { direction: 'AR' | 'AP'; settlementStatus: string | null }
type InvoiceList = { items?: Invoice[]; data?: Invoice[] }

const PRESETS = [7, 30, 90]

function Amount({ value }: { value: string }) {
  return <span>{formatInvoiceMoney(value, 'VND')}</span>
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function Card({ title, value, caption }: { title: string; value: string; caption: string }) {
  return <div className="rounded-xl border border-border bg-surface p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p><p className="mt-4 text-3xl font-normal"><Amount value={value} /></p><p className="mt-2 text-sm text-muted-foreground">{caption}</p></div>
}

function StatusCard({ title, subtitle, invoices, emptyMessage, t }: { title: string; subtitle: string; invoices: Invoice[]; emptyMessage: string; t: ReturnType<typeof useT> }) {
  const counts = { SETTLED: 0, PARTIALLY_PAID: 0, UNSETTLED: 0 }
  invoices.forEach((invoice) => {
    const status = invoice.settlementStatus === 'SETTLED' || invoice.settlementStatus === 'PARTIALLY_PAID' ? invoice.settlementStatus : 'UNSETTLED'
    counts[status] += 1
  })
  const data = [
    { name: t('invoice.dashboard.settled'), value: counts.SETTLED },
    { name: t('invoice.dashboard.partiallyPaid'), value: counts.PARTIALLY_PAID },
    { name: t('invoice.dashboard.unsettled'), value: counts.UNSETTLED },
  ]
  return <div className="rounded-xl border border-border bg-surface p-5 shadow-sm"><h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>{invoices.length === 0 ? <div className="mt-5 flex min-h-44 items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">{emptyMessage}</div> : <PieChart className="mt-3" data={data} variant="donut" showLabel emptyMessage={emptyMessage} />}</div>
}

export default function InvoiceDashboardPage() {
  const t = useT()
  const [invoices, setInvoices] = React.useState<Invoice[]>([])
  const [summary, setSummary] = React.useState<InvoiceSummaryDto | null>(null)
  const [forecast, setForecast] = React.useState<InvoiceForecastDto | null>(null)
  const [cutoff, setCutoff] = React.useState(30)
  const [loading, setLoading] = React.useState(true)
  const [summaryLoading, setSummaryLoading] = React.useState(false)
  const [error, setError] = React.useState(false)

  const loadForecast = React.useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const [forecastCall, listCall] = await Promise.all([
        apiCall<InvoiceForecastDto>('/api/invoice/forecast'),
        apiCall<InvoiceList>('/api/invoice/invoices?pageSize=100'),
      ])
      if (!forecastCall.ok || !forecastCall.result) throw new Error('[internal] invoice forecast load failed')
      setForecast(forecastCall.result)
      setInvoices(listCall.result?.items ?? listCall.result?.data ?? [])
      setCutoff(Math.min(30, forecastCall.result.horizonDays))
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSummary = React.useCallback(async (nextForecast: InvoiceForecastDto, nextCutoff: number) => {
    setSummaryLoading(true)
    try {
      const query = nextCutoff >= nextForecast.horizonDays ? '' : `?throughDate=${addDays(nextForecast.today, nextCutoff)}`
      const response = await apiCall<InvoiceSummaryDto>(`/api/invoice/summary${query}`)
      if (!response.ok || !response.result) throw new Error('[internal] invoice summary load failed')
      setSummary(response.result)
    } catch {
      setError(true)
    } finally {
      setSummaryLoading(false)
    }
  }, [])

  React.useEffect(() => { void loadForecast() }, [loadForecast])

  React.useEffect(() => {
    if (forecast) void loadSummary(forecast, cutoff)
  }, [cutoff, forecast, loadSummary])

  if (loading || !forecast) return <Page><PageBody><LoadingMessage label={t('invoice.dashboard.loading')} /></PageBody></Page>
  if (error || !summary) return <Page><PageBody><ErrorMessage label={t('invoice.dashboard.error')} action={<Button type="button" onClick={() => { void loadForecast() }}>{t('invoice.actions.retry')}</Button>} /></PageBody></Page>

  const selectedCutoff = Math.min(cutoff, forecast.horizonDays)
  const throughDate = addDays(forecast.today, selectedCutoff)
  const chartData = forecast.net.points
    .filter((point) => point.date <= throughDate)
    .map((point) => ({
      date: point.date,
      arAmount: Number(forecast.receivable.points.find((item) => item.date === point.date)?.cumulative ?? 0),
      apAmount: Number(forecast.payable.points.find((item) => item.date === point.date)?.cumulative ?? 0),
      netAmount: Number(point.cumulative),
    }))
  const netPoint = [...forecast.net.points].reverse().find((point) => point.date <= throughDate)
  const netTotal = netPoint?.cumulative ?? '0'

  return <Page><PageBody className="space-y-5">
    <div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-normal">{t('invoice.dashboard.title')}</h1><p className="text-sm text-muted-foreground">{t('invoice.dashboard.subtitle')}</p></div><InvoiceSyncButton onCompleted={() => { void loadForecast() }} /></div>
    <h2 className="text-lg font-medium">{t('invoice.dashboard.overview')}</h2>
    {summary.ratesStale || forecast.ratesStale ? <p className="rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-2 text-sm text-status-warning-text">{t('invoice.dashboard.staleRates')}</p> : null}
    <div className="grid gap-4 sm:grid-cols-3"><Card title={t('invoice.dashboard.apOutstanding')} value={summary.ap.outstandingAmount} caption={t('invoice.dashboard.payablesCaption')} /><Card title={t('invoice.dashboard.arOutstanding')} value={summary.ar.outstandingAmount} caption={t('invoice.dashboard.receivablesCaption')} /><Card title={t('invoice.dashboard.netPosition')} value={summary.netPosition} caption={t('invoice.dashboard.netCaption')} /></div>
    <div className="grid gap-4 lg:grid-cols-3"><section className="rounded-xl border border-border bg-surface p-5 shadow-sm lg:col-span-2"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold uppercase tracking-wide">{t('invoice.dashboard.forecast')}</h2><div className="flex gap-1 rounded-md border border-border p-1">{PRESETS.filter((days) => days <= forecast.horizonDays).map((days) => <Button key={days} type="button" size="sm" variant={selectedCutoff === days ? 'default' : 'ghost'} onClick={() => setCutoff(days)}>{t('invoice.dashboard.days', { count: days })}</Button>)}<Button type="button" size="sm" variant={selectedCutoff === forecast.horizonDays ? 'default' : 'ghost'} onClick={() => setCutoff(forecast.horizonDays)}>{t('invoice.dashboard.horizon')}</Button></div></div><p className="mt-3 text-2xl text-primary"><Amount value={netTotal} /></p><p className="text-sm text-muted-foreground">{t('invoice.dashboard.forecastNet')} · {throughDate}</p><div className="mt-4"><Slider value={[selectedCutoff]} min={1} max={Math.max(forecast.horizonDays, 1)} step={1} onValueChange={(value) => { const next = value[0]; if (next !== undefined) setCutoff(next) }} aria-label={t('invoice.dashboard.horizon')} /></div><LineChart className="mt-3" data={chartData} index="date" categories={['arAmount', 'apAmount', 'netAmount']} categoryLabels={{ arAmount: t('invoice.dashboard.ar'), apAmount: t('invoice.dashboard.ap'), netAmount: t('invoice.dashboard.net') }} valueFormatter={(value) => formatInvoiceMoney(value, 'VND')} showXAxis={false} showYAxis={false} showZeroLine emptyMessage={t('invoice.dashboard.noForecast')} /></section><div className="space-y-4 lg:col-span-1"><StatusCard title={t('invoice.dashboard.receivablesStatus')} subtitle={t('invoice.dashboard.receivablesStatusSubtitle')} invoices={invoices.filter((invoice) => invoice.direction === 'AR')} emptyMessage={t('invoice.dashboard.noReceivables')} t={t} /><StatusCard title={t('invoice.dashboard.payablesStatus')} subtitle={t('invoice.dashboard.payablesStatusSubtitle')} invoices={invoices.filter((invoice) => invoice.direction === 'AP')} emptyMessage={t('invoice.dashboard.noPayables')} t={t} /></div></div>
    {summaryLoading ? <p className="text-sm text-muted-foreground">{t('invoice.dashboard.loading')}</p> : null}
  </PageBody></Page>
}
