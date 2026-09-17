'use client'

import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useInvoiceT as useT } from '../../../lib/useInvoiceT'
import { InvoiceSyncDialog, loadSyncAvailability, type SyncAvailability, type SyncJob } from './InvoiceSyncDialog'

const ACTIVE_STATES = new Set(['QUEUED', 'AUTHENTICATING', 'FETCHING', 'PERSISTING'])

export function InvoiceSyncButton({ onCompleted }: { onCompleted: () => void }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [availability, setAvailability] = React.useState<SyncAvailability | null>(null)
  const [latestJob, setLatestJob] = React.useState<SyncJob | null>(null)
  const load = React.useCallback(async () => {
    setLoading(true)
    const next = await loadSyncAvailability()
    setAvailability(next)
    setLatestJob(next?.latestJob ?? null)
    setLoading(false)
  }, [])
  React.useEffect(() => {
    void load()
    const interval = window.setInterval(() => { void load() }, 30_000)
    return () => window.clearInterval(interval)
  }, [load])

  if (loading) return <Button type="button" variant="outline" disabled><Spinner />{t('invoice.sync.loading', 'Checking sync…')}</Button>
  if (!availability) return <Button type="button" variant="outline" disabled title={t('invoice.sync.unavailable', 'Tax portal sync is unavailable for this organization.')}>{t('invoice.dashboard.sync')}</Button>
  const active = Boolean(latestJob && ACTIVE_STATES.has(latestJob.state))
  const unavailable = !availability.canSync
  return <>
    <Button type="button" disabled={unavailable} title={unavailable ? (availability.reason === 'cooldown' ? t('invoice.sync.cooldown', 'Sync is temporarily unavailable.') : t('invoice.sync.unavailable', 'Tax portal sync is unavailable for this organization.')) : undefined} onClick={() => setOpen(true)}>
      <RefreshCw className={active ? 'animate-spin' : undefined} aria-hidden="true" />
      {active ? t('invoice.sync.syncing', 'Syncing… {percent}%', { percent: latestJob?.progress ?? 0 }) : t('invoice.dashboard.sync')}
    </Button>
    {availability.lastSyncAt ? <span className="text-xs text-muted-foreground">{t('invoice.sync.lastSync', 'Last sync: {date}', { date: new Date(availability.lastSyncAt).toLocaleString() })}</span> : null}
    <InvoiceSyncDialog open={open} onOpenChange={setOpen} availability={availability} initialJob={latestJob} onJobChange={setLatestJob} onCompleted={() => { onCompleted(); void load() }} />
  </>
}
