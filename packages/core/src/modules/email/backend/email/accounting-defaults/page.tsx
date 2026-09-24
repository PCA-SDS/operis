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
import { ACCOUNTING_DEFAULT_FIELDS, withoutReservedEmailSystemVariables } from '../../../lib/accountingDefaults'

type DefaultsResponse = {
  default_sender_name: string | null
  default_reply_to: string | null
  placeholders: Record<string, unknown>
  link_placeholders: Record<string, unknown>
  rules: Record<string, unknown>
  updatedAt: string | null
}

type DefaultsForm = {
  values: Record<string, string>
  preservedValues: Record<string, string>
  defaultSenderName: string | null
  defaultReplyTo: string | null
  linkPlaceholders: Record<string, unknown>
  rules: Record<string, unknown>
  updatedAt: string | null
}

const fieldCopy: Record<(typeof ACCOUNTING_DEFAULT_FIELDS)[number], { label: string; help: string; placeholder: string }> = {
  currentTaxQuarter: { label: 'Current tax quarter', help: 'Current tax reporting quarter available as {{currentTaxQuarter}}.', placeholder: 'Q3 2026' },
  currentAccountingPeriod: { label: 'Current accounting period', help: 'Current accounting month or period available as {{currentAccountingPeriod}}.', placeholder: 'September 2026' },
  financialYear: { label: 'Financial year', help: 'Financial year available as {{financialYear}}.', placeholder: '2026' },
  accountingContactName: { label: 'Accounting contact name', help: 'Accounting contact available as {{accountingContactName}}.', placeholder: 'Accounting Team' },
  accountingContactPhone: { label: 'Accounting contact phone', help: 'Accounting contact phone available as {{accountingContactPhone}}.', placeholder: '+84 123 456 789' },
  paymentInstructions: { label: 'Payment instructions', help: 'Reusable payment instructions available as {{paymentInstructions}}.', placeholder: 'Please include the invoice number in your transfer.' },
  bankAccountReference: { label: 'Bank-account reference', help: 'Bank reference available as {{bankAccountReference}}.', placeholder: 'PCA-ACCOUNTING' },
  defaultCurrency: { label: 'Default currency', help: 'Default currency available as {{defaultCurrency}}.', placeholder: 'VND' },
  taxAuthorityName: { label: 'Tax authority name', help: 'Tax authority name available as {{taxAuthorityName}}.', placeholder: 'General Department of Taxation' },
  standardDisclaimer: { label: 'Standard disclaimer/footer', help: 'Standard footer available as {{standardDisclaimer}}.', placeholder: 'This message is for accounting information only.' },
  officeAddress: { label: 'Office address', help: 'Office address available as {{officeAddress}}.', placeholder: '123 Example Street' },
}

const emptyValues = Object.fromEntries(ACCOUNTING_DEFAULT_FIELDS.map((key) => [key, '']))

function toForm(defaults: DefaultsResponse): DefaultsForm {
  const saved = withoutReservedEmailSystemVariables(defaults.placeholders)
  const approved = new Set<string>(ACCOUNTING_DEFAULT_FIELDS)
  return {
    values: Object.fromEntries(ACCOUNTING_DEFAULT_FIELDS.map((key) => [key, saved[key] ?? ''])),
    preservedValues: Object.fromEntries(Object.entries(saved).filter(([key]) => !approved.has(key))),
    defaultSenderName: defaults.default_sender_name,
    defaultReplyTo: defaults.default_reply_to,
    linkPlaceholders: defaults.link_placeholders,
    rules: defaults.rules,
    updatedAt: defaults.updatedAt,
  }
}

export default function EmailAccountingDefaultsPage() {
  const t = useT()
  const [form, setForm] = React.useState<DefaultsForm>({
    values: emptyValues,
    preservedValues: {},
    defaultSenderName: null,
    defaultReplyTo: null,
    linkPlaceholders: {},
    rules: {},
    updatedAt: null,
  })
  const [error, setError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

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
        setError(err instanceof Error ? err.message.replace(/^\[internal\]\s*/, '') : t('email.accountingDefaults.errors.load', 'Failed to load accounting defaults'))
        setIsLoading(false)
      }
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [t])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSaving(true)
    try {
      const placeholders = {
        ...form.preservedValues,
        ...Object.fromEntries(Object.entries(form.values).filter(([, value]) => value.trim().length > 0)),
      }
      const response = await updateCrud<DefaultsResponse>('email/accounting-defaults', {
        expected_updated_at: form.updatedAt ?? undefined,
        default_sender_name: form.defaultSenderName,
        default_reply_to: form.defaultReplyTo,
        placeholders,
        link_placeholders: form.linkPlaceholders,
        rules: form.rules,
      }, {
        fallbackResult: null,
        headers: buildOptimisticLockHeader(form.updatedAt),
        errorMessage: t('email.accountingDefaults.errors.save', 'Failed to save accounting defaults'),
      })
      if (response.result) setForm(toForm(response.result))
      flash(t('email.accountingDefaults.saved', 'Accounting defaults saved.'), 'success')
    } catch (err) {
      if (surfaceRecordConflict(err, t)) return
      setError(err instanceof Error ? err.message.replace(/^\[internal\]\s*/, '') : t('email.accountingDefaults.errors.save', 'Failed to save accounting defaults'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title={t('email.accountingDefaults.title', 'Accounting Defaults')}
        description={t('email.accountingDefaults.description', 'Manage reusable tenant accounting values used by email templates and Compose.')}
        actions={<Button variant="secondary" asChild><Link href="/backend/email/templates">{t('email.common.back', 'Back')}</Link></Button>}
      />
      <PageBody>
        {error ? <ErrorMessage label={error} /> : null}
        {isLoading ? (
          <LoadingMessage label={t('email.accountingDefaults.loading', 'Loading accounting defaults…')} />
        ) : (
          <form className="space-y-4 rounded-lg border bg-surface p-4" onSubmit={submit}>
            <div className={PANEL_CLASS}>
              <p className="text-sm font-medium"><HelpLabel help={t('email.accountingDefaults.scope.help', 'Defaults are scoped to the current tenant and organization only.')}>{t('email.accountingDefaults.scope.title', 'Tenant accounting defaults')}</HelpLabel></p>
              <p className="text-xs text-muted-foreground">{t('email.accountingDefaults.scope.description', 'These values are system variables for accounting templates in the selected tenant. Recipient and company variables are generated by Compose and cannot be overridden here.')}</p>
            </div>
            <section className={PANEL_CLASS}>
              <div>
                <h2 className="text-sm font-medium">{t('email.accountingDefaults.placeholders.title', 'Accounting system variables')}</h2>
                <p className="text-xs text-muted-foreground">{t('email.accountingDefaults.placeholders.description', 'Set reusable values once, then reference the shown variable key in templates.')}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {ACCOUNTING_DEFAULT_FIELDS.map((key) => {
                  const copy = fieldCopy[key]
                  return (
                    <label className="block text-sm font-medium" key={key}>
                      <HelpLabel help={copy.help}>{copy.label}</HelpLabel>
                      <code className="ml-2 text-xs text-muted-foreground">{`{{${key}}}`}</code>
                      <Input
                        className="mt-1"
                        value={form.values[key] ?? ''}
                        onChange={(event) => setForm((current) => ({
                          ...current,
                          values: { ...current.values, [key]: event.target.value },
                        }))}
                        placeholder={copy.placeholder}
                      />
                    </label>
                  )
                })}
              </div>
            </section>
            <div className="flex justify-end gap-2"><Button type="button" variant="soft" asChild><Link href="/backend/email/templates">{t('email.common.cancel', 'Cancel')}</Link></Button><Button type="submit" disabled={isSaving}>{isSaving ? t('email.common.saving', 'Saving…') : t('email.accountingDefaults.save', 'Save Defaults')}</Button></div>
          </form>
        )}
      </PageBody>
    </Page>
  )
}
