'use client'

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'

type DefaultsResponse = {
  default_sender_name: string | null
  default_reply_to: string | null
  placeholders: Record<string, unknown>
  link_placeholders: Record<string, unknown>
  rules: Record<string, unknown>
  updatedAt: string | null
}

type DefaultsForm = {
  defaultSenderName: string
  defaultReplyTo: string
  placeholders: string
  linkPlaceholders: string
  rules: string
  updatedAt: string | null
}

const emptyForm: DefaultsForm = {
  defaultSenderName: '',
  defaultReplyTo: '',
  placeholders: '{}',
  linkPlaceholders: '{}',
  rules: '{}',
  updatedAt: null,
}

const pcaStarterDefaults = {
  defaultSenderName: 'PCA Accounting',
  defaultReplyTo: '',
  placeholders: JSON.stringify({
    greeting: 'Dear Client,',
    companyCode: 'ACME',
    accountingPeriod: 'Q1 2026',
    quarterShort: 'Q1',
    quarterPeriod: 'Quarter 1 2026',
    bankStatementPeriod: '01/01/2026 to 31/03/2026',
    submissionDeadline: 'April 7, 2026',
    declarationDeadline: 'April 29, 2026',
    paymentDeadline: 'April 29, 2026',
    taxQuarter: 'Q1',
  }, null, 2),
  linkPlaceholders: JSON.stringify({
    uploadLink: 'https://example.com/client-upload-folder',
    vatPitReportsLink: 'https://example.com/vat-pit-reports-folder',
    taxTrackingLink: 'https://example.com/tax-obligations-tracking-sheet',
    citReportLink: 'https://example.com/cit-report-sheet',
  }, null, 2),
  rules: JSON.stringify({
    selection: 'rules-match-accounting-metadata',
    requestDocuments: { type: 'request_documents' },
    taxWithPayable: { type: 'tax_report', hasTaxPayable: true, hasCit: false },
    taxNoPayable: { type: 'tax_report', hasTaxPayable: false, hasCit: false },
    q3Cit: { type: 'tax_report', hasTaxPayable: true, hasCit: true, quarter: 'Q3' },
    q4Cit: { type: 'tax_report', hasTaxPayable: true, hasCit: true, quarter: 'Q4' },
  }, null, 2),
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value || '{}') as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function toForm(defaults: DefaultsResponse): DefaultsForm {
  return {
    defaultSenderName: defaults.default_sender_name ?? '',
    defaultReplyTo: defaults.default_reply_to ?? '',
    placeholders: JSON.stringify(defaults.placeholders ?? {}, null, 2),
    linkPlaceholders: JSON.stringify(defaults.link_placeholders ?? {}, null, 2),
    rules: JSON.stringify(defaults.rules ?? {}, null, 2),
    updatedAt: defaults.updatedAt,
  }
}

export default function EmailAccountingDefaultsPage() {
  const [form, setForm] = React.useState<DefaultsForm>(emptyForm)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  const setField = <K extends keyof DefaultsForm>(key: K, value: DefaultsForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const response = await apiCall<DefaultsResponse>('/api/email/accounting-defaults', { signal: controller.signal })
      if (cancelled) return
      if (!response.ok) throw new Error('Failed to load accounting defaults')
      if (response.result) setForm(toForm(response.result))
      setIsLoading(false)
    }
    void load().catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Failed to load accounting defaults')
        setIsLoading(false)
      }
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setIsSaving(true)
    try {
      const response = await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(form.updatedAt),
        () => apiCall<DefaultsResponse>('/api/email/accounting-defaults', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expected_updated_at: form.updatedAt ?? undefined,
            default_sender_name: form.defaultSenderName,
            default_reply_to: form.defaultReplyTo,
            placeholders: parseJsonObject(form.placeholders, 'Placeholders'),
            link_placeholders: parseJsonObject(form.linkPlaceholders, 'Link placeholders'),
            rules: parseJsonObject(form.rules, 'Rules'),
          }),
        }),
      )
      if (!response.ok) {
        const body = response.result as { error?: string; message?: string } | undefined
        throw new Error(body?.error ?? body?.message ?? 'Failed to save accounting defaults')
      }
      if (response.result) setForm(toForm(response.result))
      setNotice('Accounting defaults saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save accounting defaults')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Email Accounting Defaults</h1>
            <p className="mt-1 text-sm text-muted-foreground">Manage tenant-owned sender defaults, reusable placeholders, sample links, and workflow rules.</p>
          </div>
          <Button variant="secondary" asChild><Link href="/backend/email/templates">Back</Link></Button>
        </div>
        {error ? <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
        {notice ? <div className="mb-4 rounded-md border border-border bg-muted px-4 py-3 text-sm text-foreground">{notice}</div> : null}
        {isLoading ? (
          <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">Loading accounting defaults…</div>
        ) : (
          <form className="space-y-4 rounded-lg border bg-card p-4" onSubmit={submit}>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3">
              <div>
                <p className="text-sm font-medium">PCA accounting starter</p>
                <p className="text-xs text-muted-foreground">Loads safe sample values and placeholder links for user testing; it does not use customer Drive or Sheets URLs.</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => {
                setForm((current) => ({
                  ...current,
                  defaultSenderName: pcaStarterDefaults.defaultSenderName,
                  defaultReplyTo: pcaStarterDefaults.defaultReplyTo,
                  placeholders: pcaStarterDefaults.placeholders,
                  linkPlaceholders: pcaStarterDefaults.linkPlaceholders,
                  rules: pcaStarterDefaults.rules,
                }))
              }}>Use PCA Starter</Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium">Default sender name<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.defaultSenderName} onChange={(event) => setField('defaultSenderName', event.target.value)} /></label>
              <label className="block text-sm font-medium">Default reply-to<input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.defaultReplyTo} onChange={(event) => setField('defaultReplyTo', event.target.value)} placeholder="accounting@example.com" /></label>
            </div>
            <label className="block text-sm font-medium">Common placeholders JSON<textarea className="mt-1 min-h-36 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm" value={form.placeholders} onChange={(event) => setField('placeholders', event.target.value)} /></label>
            <label className="block text-sm font-medium">Sample link placeholders JSON<textarea className="mt-1 min-h-36 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm" value={form.linkPlaceholders} onChange={(event) => setField('linkPlaceholders', event.target.value)} /></label>
            <label className="block text-sm font-medium">Workflow rules JSON<textarea className="mt-1 min-h-36 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm" value={form.rules} onChange={(event) => setField('rules', event.target.value)} /></label>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" asChild><Link href="/backend/email/templates">Cancel</Link></Button><Button type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save Defaults'}</Button></div>
          </form>
        )}
      </PageBody>
    </Page>
  )
}
