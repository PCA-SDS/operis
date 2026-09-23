'use client'

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { HelpLabel } from '../../../components/HelpLabel'
import { PANEL_CLASS } from '../../../components/formStyles'
import { parseJsonObject } from '../../../components/templateHtml'

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

function KeyValueRows({
  keyPlaceholder,
  onChange,
  removeLabel,
  rowKeyPrefix,
  rows,
  valuePlaceholder,
}: {
  keyPlaceholder: string
  onChange: (rows: KeyValueRow[]) => void
  removeLabel: string
  rowKeyPrefix: string
  rows: KeyValueRow[]
  valuePlaceholder: string
}) {
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={`${rowKeyPrefix}-${index}`} className="grid gap-2 md:grid-cols-[minmax(160px,1fr)_minmax(180px,1fr)_auto]">
          <Input value={row.key} onChange={(event) => {
            const next = [...rows]
            next[index] = { ...row, key: event.target.value }
            onChange(next)
          }} placeholder={keyPlaceholder} />
          <Input value={row.value} onChange={(event) => {
            const next = [...rows]
            next[index] = { ...row, value: event.target.value }
            onChange(next)
          }} placeholder={valuePlaceholder} />
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}>{removeLabel}</Button>
        </div>
      ))}
    </div>
  )
}

export default function EmailAccountingDefaultsPage() {
  const t = useT()
  const [form, setForm] = React.useState<DefaultsForm>(emptyForm)
  const [error, setError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  const setField = <K extends keyof DefaultsForm>(key: K, value: DefaultsForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const placeholderRows = React.useMemo(() => objectToRows(form.placeholders), [form.placeholders])
  const linkPlaceholderRows = React.useMemo(() => objectToRows(form.linkPlaceholders), [form.linkPlaceholders])
  const setPlaceholderRows = (rows: KeyValueRow[]) => setField('placeholders', rowsToJson(rows))
  const setLinkPlaceholderRows = (rows: KeyValueRow[]) => setField('linkPlaceholders', rowsToJson(rows))
  const removeLabel = t('email.common.remove', 'Remove')

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
    setIsSaving(true)
    try {
      const response = await updateCrud<DefaultsResponse>('email/accounting-defaults', {
        expected_updated_at: form.updatedAt ?? undefined,
        default_sender_name: form.defaultSenderName,
        default_reply_to: form.defaultReplyTo,
        placeholders: parseJsonObject(form.placeholders, 'Placeholders'),
        link_placeholders: parseJsonObject(form.linkPlaceholders, 'Link placeholders'),
        rules: parseJsonObject(form.rules, 'Rules'),
      }, {
        fallbackResult: null,
        headers: buildOptimisticLockHeader(form.updatedAt),
        errorMessage: t('email.accountingDefaults.errors.save', 'Failed to save accounting defaults'),
      })
      if (response.result) setForm(toForm(response.result))
      flash(t('email.accountingDefaults.saved', 'Accounting defaults saved.'), 'success')
    } catch (err) {
      if (surfaceRecordConflict(err, t)) return
      setError(err instanceof Error ? err.message.replace(/^\[internal]\s*/, '') : t('email.accountingDefaults.errors.save', 'Failed to save accounting defaults'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title={t('email.accountingDefaults.title', 'Accounting Defaults')}
        description={t('email.accountingDefaults.description', 'Manage tenant-owned sender defaults, reusable placeholders, sample links, and workflow rules.')}
        actions={<Button variant="secondary" asChild><Link href="/backend/email/templates">{t('email.common.back', 'Back')}</Link></Button>}
      />
      <PageBody>
        {error ? <ErrorMessage label={error} /> : null}
        {isLoading ? (
          <LoadingMessage label={t('email.accountingDefaults.loading', 'Loading accounting defaults…')} />
        ) : (
          <form className="space-y-4 rounded-lg border bg-surface p-4" onSubmit={submit}>
            <div className={PANEL_CLASS}>
              <p className="text-sm font-medium"><HelpLabel help={t('email.accountingDefaults.scope.help', 'Defaults are scoped to the current tenant only. PCA-specific values should be configured only inside the PCA tenant.')}>{t('email.accountingDefaults.scope.title', 'Tenant accounting defaults')}</HelpLabel></p>
              <p className="text-xs text-muted-foreground">{t('email.accountingDefaults.scope.description', 'These values belong only to the current tenant. Add PCA-specific values only inside the PCA tenant, not as global Operis defaults.')}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium"><HelpLabel help={t('email.accountingDefaults.senderName.help', 'Name shown as the sender when accounting emails are composed from this tenant.')}>{t('email.accountingDefaults.senderName.label', 'Default sender name')}</HelpLabel><Input className="mt-1" value={form.defaultSenderName} onChange={(event) => setField('defaultSenderName', event.target.value)} /></label>
              <label className="block text-sm font-medium"><HelpLabel help={t('email.accountingDefaults.replyTo.help', 'Reply-to mailbox used for accounting emails. Leave blank if each sender chooses it later.')}>{t('email.accountingDefaults.replyTo.label', 'Default reply-to')}</HelpLabel><Input className="mt-1" type="email" value={form.defaultReplyTo} onChange={(event) => setField('defaultReplyTo', event.target.value)} placeholder={t('email.accountingDefaults.replyTo.placeholder', 'accounting@example.com')} /></label>
            </div>
            <section className={PANEL_CLASS}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-medium"><HelpLabel help={t('email.accountingDefaults.placeholders.help', 'Reusable accounting values that templates can use as custom variables, such as a quarter name or filing deadline.')}>{t('email.accountingDefaults.placeholders.title', 'Common accounting placeholders')}</HelpLabel></h2>
                  <p className="text-xs text-muted-foreground">{t('email.accountingDefaults.placeholders.description', 'Default sample values available to templates, such as periods and filing deadlines.')}</p>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={() => setPlaceholderRows([...placeholderRows, { key: '', value: '' }])}>{t('email.accountingDefaults.placeholders.add', 'Add placeholder')}</Button>
              </div>
              <KeyValueRows
                keyPlaceholder="quarterPeriod"
                onChange={setPlaceholderRows}
                removeLabel={removeLabel}
                rowKeyPrefix="placeholder"
                rows={placeholderRows}
                valuePlaceholder="Quarter 1 2026"
              />
            </section>
            <section className={PANEL_CLASS}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-medium"><HelpLabel help={t('email.accountingDefaults.links.help', 'Reusable placeholder URLs for template previews. Use safe placeholders, not real customer Drive or Sheets links.')}>{t('email.accountingDefaults.links.title', 'Sample link placeholders')}</HelpLabel></h2>
                  <p className="text-xs text-muted-foreground">{t('email.accountingDefaults.links.description', 'Safe placeholder URLs only. Do not paste real customer Google Drive or Sheets links here.')}</p>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={() => setLinkPlaceholderRows([...linkPlaceholderRows, { key: '', value: 'https://example.com/' }])}>{t('email.accountingDefaults.links.add', 'Add link')}</Button>
              </div>
              <KeyValueRows
                keyPlaceholder="vatPitReportsLink"
                onChange={setLinkPlaceholderRows}
                removeLabel={removeLabel}
                rowKeyPrefix="link-placeholder"
                rows={linkPlaceholderRows}
                valuePlaceholder="https://example.com/vat-pit-reports-folder"
              />
            </section>
            <input type="hidden" value={form.rules} readOnly />
            <div className="flex justify-end gap-2"><Button type="button" variant="soft" asChild><Link href="/backend/email/templates">{t('email.common.cancel', 'Cancel')}</Link></Button><Button type="submit" disabled={isSaving}>{isSaving ? t('email.common.saving', 'Saving…') : t('email.accountingDefaults.save', 'Save Defaults')}</Button></div>
          </form>
        )}
      </PageBody>
    </Page>
  )
}
