'use client'

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
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

type KeyValueRow = {
  key: string
  value: string
}

function objectToRows(value: string): KeyValueRow[] {
  try {
    return Object.entries(parseJsonObject(value, 'Values')).map(([key, item]) => ({
      key,
      value: String(item ?? ''),
    }))
  } catch {
    return []
  }
}

function rowsToJson(rows: KeyValueRow[]): string {
  return JSON.stringify(
    Object.fromEntries(rows
      .map((row) => [row.key.trim(), row.value] as const)
      .filter(([key]) => key.length > 0)),
    null,
    2,
  )
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value || '{}') as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`[internal] ${label} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function HelpLabel({ children, help }: { children: React.ReactNode; help: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{children}</span>
      <span className="group relative inline-flex">
        <button
          type="button"
          aria-label={help}
          className="inline-flex size-4 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
        >
          i
        </button>
        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden w-64 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs font-normal text-popover-foreground shadow-md group-hover:block group-focus-within:block">
          {help}
        </span>
      </span>
    </span>
  )
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
  const t = useT()
  const [form, setForm] = React.useState<DefaultsForm>(emptyForm)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  const setField = <K extends keyof DefaultsForm>(key: K, value: DefaultsForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const placeholderRows = React.useMemo(() => objectToRows(form.placeholders), [form.placeholders])
  const linkPlaceholderRows = React.useMemo(() => objectToRows(form.linkPlaceholders), [form.linkPlaceholders])
  const setPlaceholderRows = (rows: KeyValueRow[]) => setField('placeholders', rowsToJson(rows))
  const setLinkPlaceholderRows = (rows: KeyValueRow[]) => setField('linkPlaceholders', rowsToJson(rows))

  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const response = await apiCall<DefaultsResponse>('/api/email/accounting-defaults', { signal: controller.signal })
      if (cancelled) return
      if (!response.ok) throw new Error('[internal] Failed to load accounting defaults')
      if (response.result) setForm(toForm(response.result))
      setIsLoading(false)
    }
    void load().catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message.replace(/^\[internal]\s*/, '') : t('email.accountingDefaults.errors.load', 'Failed to load accounting defaults'))
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
        throw new Error(body?.error ?? body?.message ?? t('email.accountingDefaults.errors.save', 'Failed to save accounting defaults'))
      }
      if (response.result) setForm(toForm(response.result))
      setNotice(t('email.accountingDefaults.saved', 'Accounting defaults saved.'))
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^\[internal]\s*/, '') : t('email.accountingDefaults.errors.save', 'Failed to save accounting defaults'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('email.accountingDefaults.title', 'Accounting Defaults')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('email.accountingDefaults.description', 'Manage tenant-owned sender defaults, reusable placeholders, sample links, and workflow rules.')}</p>
          </div>
          <Button variant="secondary" asChild><Link href="/backend/email/templates">{t('email.common.back', 'Back')}</Link></Button>
        </div>
        {error ? <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
        {notice ? <div className="mb-4 rounded-md border border-border bg-muted px-4 py-3 text-sm text-foreground">{notice}</div> : null}
        {isLoading ? (
          <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{t('email.accountingDefaults.loading', 'Loading accounting defaults…')}</div>
        ) : (
          <form className="space-y-4 rounded-lg border bg-card p-4" onSubmit={submit}>
            <div className="rounded-md border bg-background p-3">
              <p className="text-sm font-medium"><HelpLabel help={t('email.accountingDefaults.scope.help', 'Defaults are scoped to the current tenant only. PCA-specific values should be configured only inside the PCA tenant.')}>{t('email.accountingDefaults.scope.title', 'Tenant accounting defaults')}</HelpLabel></p>
              <p className="text-xs text-muted-foreground">{t('email.accountingDefaults.scope.description', 'These values belong only to the current tenant. Add PCA-specific values only inside the PCA tenant, not as global Operis defaults.')}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium"><HelpLabel help={t('email.accountingDefaults.senderName.help', 'Name shown as the sender when accounting emails are composed from this tenant.')}>{t('email.accountingDefaults.senderName.label', 'Default sender name')}</HelpLabel><input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.defaultSenderName} onChange={(event) => setField('defaultSenderName', event.target.value)} /></label>
              <label className="block text-sm font-medium"><HelpLabel help={t('email.accountingDefaults.replyTo.help', 'Reply-to mailbox used for accounting emails. Leave blank if each sender chooses it later.')}>{t('email.accountingDefaults.replyTo.label', 'Default reply-to')}</HelpLabel><input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.defaultReplyTo} onChange={(event) => setField('defaultReplyTo', event.target.value)} placeholder={t('email.accountingDefaults.replyTo.placeholder', 'accounting@example.com')} /></label>
            </div>
            <section className="space-y-3 rounded-md border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-medium"><HelpLabel help={t('email.accountingDefaults.placeholders.help', 'Reusable accounting values that templates can use as custom variables, such as a quarter name or filing deadline.')}>{t('email.accountingDefaults.placeholders.title', 'Common accounting placeholders')}</HelpLabel></h2>
                  <p className="text-xs text-muted-foreground">{t('email.accountingDefaults.placeholders.description', 'Default sample values available to templates, such as periods and filing deadlines.')}</p>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={() => setPlaceholderRows([...placeholderRows, { key: '', value: '' }])}>{t('email.accountingDefaults.placeholders.add', 'Add placeholder')}</Button>
              </div>
              <div className="space-y-2">
                {placeholderRows.map((row, index) => (
                  <div key={`placeholder-${index}`} className="grid gap-2 md:grid-cols-[minmax(160px,1fr)_minmax(180px,1fr)_auto]">
                    <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={row.key} onChange={(event) => {
                      const next = [...placeholderRows]
                      next[index] = { ...row, key: event.target.value }
                      setPlaceholderRows(next)
                    }} placeholder="quarterPeriod" />
                    <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={row.value} onChange={(event) => {
                      const next = [...placeholderRows]
                      next[index] = { ...row, value: event.target.value }
                      setPlaceholderRows(next)
                    }} placeholder="Quarter 1 2026" />
                    <Button type="button" size="sm" variant="ghost" onClick={() => setPlaceholderRows(placeholderRows.filter((_, rowIndex) => rowIndex !== index))}>{t('email.common.remove', 'Remove')}</Button>
                  </div>
                ))}
              </div>
            </section>
            <section className="space-y-3 rounded-md border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-medium"><HelpLabel help={t('email.accountingDefaults.links.help', 'Reusable placeholder URLs for template previews. Use safe placeholders, not real customer Drive or Sheets links.')}>{t('email.accountingDefaults.links.title', 'Sample link placeholders')}</HelpLabel></h2>
                  <p className="text-xs text-muted-foreground">{t('email.accountingDefaults.links.description', 'Safe placeholder URLs only. Do not paste real customer Google Drive or Sheets links here.')}</p>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={() => setLinkPlaceholderRows([...linkPlaceholderRows, { key: '', value: 'https://example.com/' }])}>{t('email.accountingDefaults.links.add', 'Add link')}</Button>
              </div>
              <div className="space-y-2">
                {linkPlaceholderRows.map((row, index) => (
                  <div key={`link-placeholder-${index}`} className="grid gap-2 md:grid-cols-[minmax(160px,1fr)_minmax(180px,1fr)_auto]">
                    <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={row.key} onChange={(event) => {
                      const next = [...linkPlaceholderRows]
                      next[index] = { ...row, key: event.target.value }
                      setLinkPlaceholderRows(next)
                    }} placeholder="vatPitReportsLink" />
                    <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={row.value} onChange={(event) => {
                      const next = [...linkPlaceholderRows]
                      next[index] = { ...row, value: event.target.value }
                      setLinkPlaceholderRows(next)
                    }} placeholder="https://example.com/vat-pit-reports-folder" />
                    <Button type="button" size="sm" variant="ghost" onClick={() => setLinkPlaceholderRows(linkPlaceholderRows.filter((_, rowIndex) => rowIndex !== index))}>{t('email.common.remove', 'Remove')}</Button>
                  </div>
                ))}
              </div>
            </section>
            <input type="hidden" value={form.rules} readOnly />
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" asChild><Link href="/backend/email/templates">{t('email.common.cancel', 'Cancel')}</Link></Button><Button type="submit" disabled={isSaving}>{isSaving ? t('email.common.saving', 'Saving…') : t('email.accountingDefaults.save', 'Save Defaults')}</Button></div>
          </form>
        )}
      </PageBody>
    </Page>
  )
}
