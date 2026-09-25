"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { DEFAULT_APPOINTMENT_EMAIL_SETTINGS, type AppointmentEmailSettings } from '../lib/email-settings'

const logger = createLogger('appointments')

const fields: Array<{ name: keyof AppointmentEmailSettings; label: string; labelKey: string; help: string; helpKey: string }> = [
  { name: 'from', label: 'Sender email', labelKey: 'from', help: 'A sender address verified with the configured email provider.', helpKey: 'fromHelp' },
  { name: 'to', label: 'Internal recipients', labelKey: 'to', help: 'Comma-separated addresses that receive new public booking notices.', helpKey: 'toHelp' },
  { name: 'cc', label: 'CC recipients', labelKey: 'cc', help: 'Optional comma-separated CC addresses.', helpKey: 'ccHelp' },
  { name: 'bcc', label: 'BCC recipients', labelKey: 'bcc', help: 'Optional comma-separated BCC addresses.', helpKey: 'bccHelp' },
  { name: 'replyTo', label: 'Reply-to email', labelKey: 'replyTo', help: 'Optional address for replies to booking emails.', helpKey: 'replyToHelp' },
]

export function AppointmentEmailSettings() {
  const t = useT()
  const translate = React.useCallback((key: string, fallback: string) => {
    const value = t(key)
    return value === key ? fallback : value
  }, [t])
  const scopeVersion = useOrganizationScopeVersion()
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: 'appointments-email-settings',
    blockedMessage: translate('appointments.config.email.errors.blocked', 'Save blocked by validation.'),
  })
  const [settings, setSettings] = React.useState<AppointmentEmailSettings>(DEFAULT_APPOINTMENT_EMAIL_SETTINGS)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const value = await readApiResultOrThrow<AppointmentEmailSettings>('/api/appointments/email-settings')
      setSettings({ ...DEFAULT_APPOINTMENT_EMAIL_SETTINGS, ...value })
    } catch (err) {
      logger.error('appointment email settings load failed', { err })
      flash(translate('appointments.config.email.errors.loadFailed', 'Failed to load appointment email settings.'), 'error')
    } finally {
      setLoading(false)
    }
  }, [translate])

  React.useEffect(() => { void load() }, [load, scopeVersion])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await runMutation({
        operation: async () => {
          // optimistic-lock-exempt: tenant-scoped module-config settings blob
          // is a single settings row without an updated_at value in the API
          // response, so there is no per-record version token to send.
          const call = await apiCall('/api/appointments/email-settings', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(settings),
          })
          if (!call.ok) await raiseCrudError(call.response, 'Failed to save appointment email settings.')
          return call
        },
        context: {
          formId: 'appointments-email-settings',
          resourceKind: 'appointments.email-settings',
          retryLastMutation,
        },
        mutationPayload: settings,
      })
      flash(translate('appointments.config.email.saved', 'Appointment email settings saved.'), 'success')
    } catch (err) {
      logger.error('appointment email settings save failed', { err })
      flash(err instanceof Error ? err.message : translate('appointments.config.email.errors.saveFailed', 'Failed to save appointment email settings.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-foreground">{translate('appointments.config.email.title', 'Public booking emails')}</h2>
        <p className="text-sm text-muted-foreground">{translate('appointments.config.email.description', 'Email addresses used for public appointment booking notifications. These settings belong to the current tenant.')}</p>
      </div>
      <form className="space-y-4" onSubmit={(event) => { void save(event) }}>
        {fields.map((field) => (
          <div className="space-y-1" key={field.name}>
            <Label htmlFor={`appointment-email-${field.name}`}>{translate(`appointments.config.email.fields.${field.labelKey}`, field.label)}</Label>
            <Input
              id={`appointment-email-${field.name}`}
              type={field.name === 'to' || field.name === 'cc' || field.name === 'bcc' || field.name === 'from' ? 'text' : 'email'}
              value={settings[field.name]}
              disabled={loading || saving}
              placeholder={
                field.name === 'to' || field.name === 'cc' || field.name === 'bcc'
                  ? translate('appointments.config.email.placeholders.recipients', 'name@example.com, team@example.com')
                  : field.name === 'from'
                    ? translate('appointments.config.email.placeholders.sender', 'Name <name@example.com>')
                    : translate('appointments.config.email.placeholders.email', 'name@example.com')
              }
              onChange={(event) => setSettings((current) => ({ ...current, [field.name]: event.target.value }))}
            />
            <p className="text-sm text-muted-foreground">{translate(`appointments.config.email.help.${field.helpKey}`, field.help)}</p>
          </div>
        ))}
        <Button type="submit" disabled={loading || saving}>{saving ? 'Saving…' : 'Save email settings'}</Button>
      </form>
    </section>
  )
}
