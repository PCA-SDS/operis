'use client'

import * as React from 'react'
import { Plus, X } from 'lucide-react'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useInvoiceT as useT } from '@open-mercato/core/modules/invoice/lib/useInvoiceT'

type SyncState = 'QUEUED' | 'AUTHENTICATING' | 'FETCHING' | 'PERSISTING' | 'DONE' | 'FAILED'
type StreamCounts = { fetched: number; new: number; updated: number; skipped: number; errors: number }
type SyncCounts = { processed: number; imported: number; updated: number; skipped: number; errors: number; ar?: StreamCounts; ap?: StreamCounts }
export type SyncJob = { jobId: string; state: SyncState; progress: number; counts: SyncCounts; startedBy?: { id: string } | null; failureCategory: string | null; failureMessage: string | null; failureRequestId?: string | null; progressJobId: string | null; updatedAt: string; finishedAt: string | null }
export type SyncAvailability = { canSync: boolean; reason: 'ok' | 'not_configured' | 'not_vietnamese' | 'cooldown' | string; taxCode: string | null; portalUrl?: string | null; activeJob?: SyncJob | null; latestJob: SyncJob | null; lastSyncAt?: string | null; retryAfterSeconds?: number }
type StartResponse = { state: 'queued' | 'already_syncing'; job?: SyncJob; jobId?: string; progressJobId?: string | null } | { state: 'auth_required'; transactionId: string; captchaSvg: string } | { state: 'cooldown'; retryAfterSeconds: number } | { state: 'unavailable'; reason: string; taxCode?: string | null; portalUrl?: string | null }
type AuthenticateResponse = { state: 'queued'; job?: SyncJob; jobId?: string; progressJobId?: string | null } | { state: 'retry'; reason: string; transactionId?: string; captchaSvg?: string; attemptsRemaining?: number } | { state: 'account_locked'; message?: string; portalUrl?: string | null } | { state: 'too_many_attempts'; retryAfterSeconds: number }
type DialogStep = 'configure' | 'authenticate' | 'retry' | 'locked' | 'cooldown' | 'progress'

const ACTIVE_STATES: SyncState[] = ['QUEUED', 'AUTHENTICATING', 'FETCHING', 'PERSISTING']
const EMPTY_COUNTS: SyncCounts = { processed: 0, imported: 0, updated: 0, skipped: 0, errors: 0 }

function createIdempotencyKey(): string { return `sync_${Date.now()}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}` }
function responseJob(response: { job?: SyncJob; jobId?: string; progressJobId?: string | null }): SyncJob | null {
  if (response.job) return response.job
  return response.jobId ? { jobId: response.jobId, state: 'QUEUED', progress: 0, counts: EMPTY_COUNTS, failureCategory: null, failureMessage: null, progressJobId: response.progressJobId ?? null, updatedAt: new Date().toISOString(), finishedAt: null } : null
}

export function InvoiceSyncDialog({ open, onOpenChange, availability, initialJob, onJobChange, onCompleted }: { open: boolean; onOpenChange: (open: boolean) => void; availability: SyncAvailability; initialJob: SyncJob | null; onJobChange: (job: SyncJob) => void; onCompleted: () => void }) {
  const t = useT()
  const today = new Date().toISOString().slice(0, 10)
  const [step, setStep] = React.useState<DialogStep>('configure')
  const [fromDate, setFromDate] = React.useState(today); const [toDate, setToDate] = React.useState(today)
  const [scopeDraft, setScopeDraft] = React.useState(''); const [scopeTaxCodes, setScopeTaxCodes] = React.useState<string[]>([])
  const [dueDateAcknowledged, setDueDateAcknowledged] = React.useState(false); const [settlementAcknowledged, setSettlementAcknowledged] = React.useState(false)
  const [transactionId, setTransactionId] = React.useState<string | null>(null); const [captchaSvg, setCaptchaSvg] = React.useState('')
  const [portalUrl, setPortalUrl] = React.useState<string | null>(availability.portalUrl ?? null); const [cooldownSeconds, setCooldownSeconds] = React.useState(0)
  const [password, setPassword] = React.useState(''); const [captchaSolution, setCaptchaSolution] = React.useState('')
  const [job, setJob] = React.useState<SyncJob | null>(initialJob); const [error, setError] = React.useState<string | null>(null); const [busy, setBusy] = React.useState(false)
  const [idempotencyKey, setIdempotencyKey] = React.useState(createIdempotencyKey)
  const completedJobRef = React.useRef<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({ contextId: 'invoice.sync' })

  React.useEffect(() => { if (open) { setError(null); setPassword(''); setCaptchaSolution(''); setPortalUrl(availability.portalUrl ?? null); if (initialJob) { setJob(initialJob); setStep('progress') } } }, [availability.portalUrl, initialJob, open])
  React.useEffect(() => {
    if (!open || step !== 'progress' || !job || !ACTIVE_STATES.includes(job.state)) return
    const controller = new AbortController()
    let cancelled = false; let timeout: ReturnType<typeof setTimeout> | null = null
    const poll = async () => {
      try {
        const call = await apiCall<SyncJob>(`/api/invoice/sync/${job.jobId}`, { signal: controller.signal })
        if (cancelled) return
        if (call.ok && call.result) {
          setJob(call.result); onJobChange(call.result); setError(null)
          if (call.result.state === 'DONE' && completedJobRef.current !== call.result.jobId) { completedJobRef.current = call.result.jobId; onCompleted() }
          if (ACTIVE_STATES.includes(call.result.state)) timeout = setTimeout(poll, 1500)
        } else { setError(t('invoice.sync.errors.status', 'Progress could not be refreshed. The server task keeps running.')); timeout = setTimeout(poll, 3000) }
      } catch {
        if (!cancelled) {
          setError(t('invoice.sync.errors.status', 'Progress could not be refreshed. The server task keeps running.'))
          timeout = setTimeout(poll, 3000)
        }
      }
    }
    timeout = setTimeout(poll, 500)
    return () => { cancelled = true; controller.abort(); if (timeout) clearTimeout(timeout) }
  }, [job?.jobId, job?.state, onCompleted, onJobChange, open, step, t])

  const moveToJob = React.useCallback((nextJob: SyncJob) => { setPassword(''); setCaptchaSolution(''); setJob(nextJob); onJobChange(nextJob); setStep('progress') }, [onJobChange])
  const start = async () => {
    setBusy(true); setError(null)
    try {
      const result = await runMutation({ operation: () => readApiResultOrThrow<StartResponse>('/api/invoice/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey, fromDate, toDate, scopeTaxCodes, acknowledgements: { dueDatesRequireConfiguration: dueDateAcknowledged, settlementIsManual: settlementAcknowledged } }) }, { errorMessage: t('invoice.sync.errors.start', 'Could not start tax portal sync.') }), context: { retryLastMutation }, mutationPayload: { fromDate, toDate, scopeTaxCodes } })
      if (result.state === 'auth_required') { setTransactionId(result.transactionId); setCaptchaSvg(result.captchaSvg); setStep('authenticate') }
      else if (result.state === 'cooldown') { setCooldownSeconds(result.retryAfterSeconds); setStep('cooldown') }
      else if (result.state === 'unavailable') { setError(t('invoice.sync.errors.unavailable', 'Portal sync is not available for this company.')); setStep('configure') }
      else { const nextJob = responseJob(result); if (nextJob) moveToJob(nextJob) }
    } catch (caught) { setError(caught instanceof Error ? caught.message : t('invoice.sync.errors.start', 'Could not start tax portal sync.')) } finally { setBusy(false) }
  }
  const authenticate = async () => {
    if (!transactionId) return
    setBusy(true); setError(null)
    try {
      const result = await runMutation({ operation: () => readApiResultOrThrow<AuthenticateResponse>('/api/invoice/sync/authenticate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transactionId, password, captchaSolution }) }, { errorMessage: t('invoice.sync.errors.authenticate', 'Tax portal authentication failed.') }), context: { retryLastMutation }, mutationPayload: {} })
      setPassword(''); setCaptchaSolution('')
      if (result.state === 'queued') { const nextJob = responseJob(result); if (nextJob) moveToJob(nextJob) }
      else if (result.state === 'retry') { if (result.transactionId) setTransactionId(result.transactionId); if (result.captchaSvg) setCaptchaSvg(result.captchaSvg); setStep('retry'); setError(result.reason === 'captcha_expired' ? t('invoice.sync.errors.captchaExpired', 'The CAPTCHA expired. Enter the new CAPTCHA.') : t('invoice.sync.errors.authRetry', 'The portal rejected the sign-in. {count} attempts remain.', { count: result.attemptsRemaining ?? 0 })) }
      else if (result.state === 'account_locked') { setPortalUrl(result.portalUrl ?? availability.portalUrl ?? null); setStep('locked'); setError(result.message ?? t('invoice.sync.errors.accountLocked', 'The tax portal account is locked.')) }
      else { setCooldownSeconds(result.retryAfterSeconds); setStep('cooldown') }
    } catch (caught) { setPassword(''); setCaptchaSolution(''); setError(caught instanceof Error ? caught.message : t('invoice.sync.errors.authenticate', 'Tax portal authentication failed.')) } finally { setBusy(false) }
  }
  const addScope = () => { const value = scopeDraft.trim(); if (value && !scopeTaxCodes.includes(value) && scopeTaxCodes.length < 200) setScopeTaxCodes((current) => [...current, value]); setScopeDraft('') }
  const submit = () => { if (step === 'configure') void start(); else if (step === 'authenticate' || step === 'retry') void authenticate() }
  const terminal = job?.state === 'DONE' || job?.state === 'FAILED'
  const canSubmit = step === 'configure' ? Boolean(fromDate && toDate && fromDate <= toDate && dueDateAcknowledged && settlementAcknowledged && availability.canSync) : Boolean(password && captchaSolution)

  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}><DialogContent size="lg" dismissible={!busy} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canSubmit && !busy) { event.preventDefault(); submit() } }}>
    <DialogHeader><DialogTitle>{t('invoice.sync.title', 'Sync from tax portal')}</DialogTitle><DialogDescription>{t('invoice.sync.description', 'Import issued and received e-invoices for company tax code {taxCode}.', { taxCode: availability.taxCode ?? '—' })}</DialogDescription></DialogHeader>
    <DialogBody className="space-y-5">{error ? <Alert status="error" style="lighter">{error}</Alert> : null}
      {step === 'configure' ? <><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="invoice-sync-from">{t('invoice.sync.fromDate', 'From date')}</Label><Input id="invoice-sync-from" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="invoice-sync-to">{t('invoice.sync.toDate', 'To date')}</Label><Input id="invoice-sync-to" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></div></div>
        <p className="text-sm text-muted-foreground">{t('invoice.sync.serverValidation', 'The server validates the date range and company scope.')}</p>
        <div className="space-y-2"><Label htmlFor="invoice-sync-scope">{t('invoice.sync.scope', 'Company tax-code scope (optional)')}</Label><div className="flex gap-2"><Input id="invoice-sync-scope" value={scopeDraft} onChange={(event) => setScopeDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addScope() } }} placeholder={t('invoice.sync.scopePlaceholder', 'Enter a tax code')} /><Button type="button" variant="outline" onClick={addScope}><Plus aria-hidden="true" />{t('invoice.sync.addScope', 'Add')}</Button></div>{scopeTaxCodes.length ? <div className="flex flex-wrap gap-2">{scopeTaxCodes.map((taxCode) => <Button key={taxCode} type="button" variant="outline" size="sm" onClick={() => setScopeTaxCodes((current) => current.filter((item) => item !== taxCode))}>{taxCode}<X aria-hidden="true" /></Button>)}</div> : null}</div>
        <Alert status="warning" style="lighter"><div className="space-y-3"><p className="font-medium">{t('invoice.sync.acknowledgements', 'Confirm before syncing')}</p><label className="flex cursor-pointer items-start gap-3"><Checkbox checked={dueDateAcknowledged} onCheckedChange={(value) => setDueDateAcknowledged(value === true)} /><span>{t('invoice.sync.ackDueDates', 'Imported due dates use partner payment terms and may need review.')}</span></label><label className="flex cursor-pointer items-start gap-3"><Checkbox checked={settlementAcknowledged} onCheckedChange={(value) => setSettlementAcknowledged(value === true)} /><span>{t('invoice.sync.ackSettlement', 'Payment state is not imported and must be managed in the application.')}</span></label></div></Alert></> : null}
      {step === 'authenticate' || step === 'retry' ? <><Alert status="information" style="lighter">{t('invoice.sync.secretNotice', 'Your password and CAPTCHA are used only for this sign-in and are not stored in browser application state.')}</Alert>{captchaSvg ? <img src={captchaSvg.startsWith('data:') ? captchaSvg : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(captchaSvg)}`} alt={t('invoice.sync.captchaAlt', 'Tax portal CAPTCHA')} className="h-20 max-w-full rounded-lg border border-border bg-surface p-2" /> : <Alert status="warning" style="lighter">{t('invoice.sync.errors.captchaUnavailable', 'CAPTCHA could not be loaded. Please try again.')}</Alert>}<div className="space-y-2"><Label htmlFor="invoice-sync-password">{t('invoice.sync.password', 'Tax portal password')}</Label><Input id="invoice-sync-password" type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="invoice-sync-captcha">{t('invoice.sync.captcha', 'CAPTCHA')}</Label><Input id="invoice-sync-captcha" autoComplete="off" value={captchaSolution} onChange={(event) => setCaptchaSolution(event.target.value)} /></div></> : null}
      {step === 'locked' ? <Alert status="error" style="lighter"><p>{error ?? t('invoice.sync.errors.accountLocked', 'The tax portal account is locked.')}</p>{portalUrl ? <a className="mt-2 inline-block underline" href={portalUrl} target="_blank" rel="noreferrer">{t('invoice.sync.portalLink', 'Open tax portal')}</a> : null}</Alert> : null}
      {step === 'cooldown' ? <Alert status="warning" style="lighter">{t('invoice.sync.errors.cooldown', 'Please wait {seconds} seconds before syncing again.', { seconds: cooldownSeconds })}</Alert> : null}
      {step === 'progress' ? <SyncProgress job={job} t={t} /> : null}</DialogBody>
    <DialogFooter leading={step === 'progress' && !terminal ? <span className="text-sm text-muted-foreground">{t('invoice.sync.backgroundNotice', 'You can close this dialog. Progress remains in the top bar.')}</span> : undefined}>{step === 'authenticate' || step === 'retry' ? <Button type="button" variant="outline" disabled={busy} onClick={() => { setPassword(''); setCaptchaSolution(''); setError(null); setStep('configure') }}>{t('invoice.sync.back', 'Back')}</Button> : null}{step === 'configure' || step === 'authenticate' || step === 'retry' ? <Button type="button" disabled={!canSubmit || busy} onClick={submit}>{busy ? <Spinner /> : null}{step === 'authenticate' ? t('invoice.sync.authenticate', 'Sign in and sync') : step === 'retry' ? t('invoice.sync.retry', 'Try again') : t('invoice.sync.continue', 'Continue')}</Button> : null}{step === 'locked' || step === 'cooldown' ? <Button type="button" onClick={() => onOpenChange(false)}>{t('invoice.sync.close', 'Close')}</Button> : null}{job?.state === 'FAILED' ? <Button type="button" onClick={() => { setError(null); setJob(null); setStep('configure'); setIdempotencyKey(createIdempotencyKey()) }}>{t('invoice.sync.retry', 'Try again')}</Button> : step === 'progress' ? <Button type="button" onClick={() => { onOpenChange(false); if (terminal) { setStep('configure'); setIdempotencyKey(createIdempotencyKey()) } }}>{terminal ? t('invoice.sync.done', 'Done') : t('invoice.sync.background', 'Run in background')}</Button> : null}</DialogFooter>
  </DialogContent></Dialog>
}

function SyncProgress({ job, t }: { job: SyncJob | null; t: ReturnType<typeof useT> }) {
  if (!job) return <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Spinner />{t('invoice.sync.starting', 'Starting sync…')}</div>
  const labels: Record<SyncState, string> = { QUEUED: t('invoice.sync.state.queued', 'Queued'), AUTHENTICATING: t('invoice.sync.state.authenticating', 'Authenticating'), FETCHING: t('invoice.sync.state.fetching', 'Fetching invoices'), PERSISTING: t('invoice.sync.state.persisting', 'Importing invoices'), DONE: t('invoice.sync.state.done', 'Completed'), FAILED: t('invoice.sync.state.failed', 'Failed') }
  const variants: Record<SyncState, StatusBadgeVariant> = { QUEUED: 'neutral', AUTHENTICATING: 'info', FETCHING: 'info', PERSISTING: 'warning', DONE: 'success', FAILED: 'error' }
  const failureMessage = job.failureCategory === 'INTERNAL_ERROR' ? null : job.failureMessage
  const stream = (value?: StreamCounts): StreamCounts => value ?? { fetched: 0, new: 0, updated: 0, skipped: 0, errors: 0 }
  const ar = stream(job.counts.ar); const ap = stream(job.counts.ap)
  const streamTable = (title: string, counts: StreamCounts) => <div className="rounded-lg border border-border bg-surface p-3"><p className="font-medium">{title}</p><dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm"><dt>{t('invoice.sync.counts.fetched', 'Fetched')}</dt><dd>{counts.fetched}</dd><dt>{t('invoice.sync.counts.new', 'New')}</dt><dd>{counts.new}</dd><dt>{t('invoice.sync.counts.updated', 'Updated')}</dt><dd>{counts.updated}</dd><dt>{t('invoice.sync.counts.skipped', 'Skipped')}</dt><dd>{counts.skipped}</dd><dt>{t('invoice.sync.counts.errors', 'Errors')}</dt><dd>{counts.errors}</dd></dl></div>
  return <div className="space-y-5"><div className="flex items-center justify-between gap-3"><StatusBadge variant={variants[job.state]} dot>{labels[job.state]}</StatusBadge><span className="text-sm text-muted-foreground">{job.progress}%</span></div><Progress value={job.progress} tone={job.state === 'FAILED' ? 'destructive' : job.state === 'DONE' ? 'success' : 'accent'} aria-label={labels[job.state]} />{job.state === 'FAILED' ? <Alert status="error" style="lighter"><p className="font-medium">{failureTitle(job.failureCategory, t)}</p><p className="mt-1">{failureMessage ?? t('invoice.sync.errors.failed', 'The sync failed. Review the details and try again.')}</p>{job.failureRequestId ? <p className="mt-2 text-xs">{t('invoice.sync.failureRequestId', 'Request ID: {id}', { id: job.failureRequestId })}</p> : null}</Alert> : null}<div className="grid gap-3 sm:grid-cols-2">{streamTable(t('invoice.sync.counts.issued', 'Issued invoices (AR)'), ar)}{streamTable(t('invoice.sync.counts.received', 'Received invoices (AP)'), ap)}</div></div>
}

function failureTitle(category: string | null, t: ReturnType<typeof useT>): string {
  const titles: Record<string, string> = { AUTH_FAILED: t('invoice.sync.failure.auth', 'Authentication expired or failed'), ACCOUNT_LOCKED: t('invoice.sync.failure.locked', 'Tax portal account locked'), PORTAL_UNREACHABLE: t('invoice.sync.failure.portal', 'Tax portal unavailable'), VALIDATION_ERROR: t('invoice.sync.failure.validation', 'Sync data was rejected'), INTERNAL_ERROR: t('invoice.sync.failure.internal', 'Internal sync error') }
  return titles[category ?? ''] ?? t('invoice.sync.failure.unknown', 'Sync failed')
}

export async function loadSyncAvailability(): Promise<SyncAvailability | null> { const result = await apiCall<SyncAvailability>('/api/invoice/sync'); return result.ok ? result.result : null }
