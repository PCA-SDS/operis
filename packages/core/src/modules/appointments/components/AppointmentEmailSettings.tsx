"use client"

import * as React from 'react'
import { Eye, LockKeyhole, Palette, RotateCcw } from 'lucide-react'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { ColorPicker } from '@open-mercato/ui/primitives/color-picker'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import {
  DEFAULT_APPOINTMENT_EMAIL_CUSTOMIZATION,
  DEFAULT_APPOINTMENT_EMAIL_SETTINGS,
  type AppointmentEmailCustomization,
  type AppointmentEmailSettings,
} from '../lib/email-settings'

const logger = createLogger('appointments')

type DeliveryField = 'from' | 'to' | 'cc' | 'bcc' | 'replyTo'
type PreviewAudience = 'internal' | 'customer'
type PreviewSizing = 'fit' | 'readable'
type PreviewResponse = Record<PreviewAudience, { subject: string; html: string }>

const deliveryFields: Array<{ name: DeliveryField; label: string; help: string; inputMode: 'email' | 'list' }> = [
  { name: 'from', label: 'Sender email', help: 'A sender address verified with the configured email provider.', inputMode: 'list' },
  { name: 'to', label: 'Internal recipients', help: 'Comma-separated addresses that receive new public booking notices.', inputMode: 'list' },
  { name: 'cc', label: 'CC recipients', help: 'Optional comma-separated CC addresses.', inputMode: 'list' },
  { name: 'bcc', label: 'BCC recipients', help: 'Optional comma-separated BCC addresses.', inputMode: 'list' },
  { name: 'replyTo', label: 'Reply-to email', help: 'Optional address for replies to booking emails.', inputMode: 'email' },
]

function cloneDefaults(): AppointmentEmailCustomization {
  return { ...DEFAULT_APPOINTMENT_EMAIL_CUSTOMIZATION }
}

function sizeEmailPreview(frame: HTMLIFrameElement, sizing: PreviewSizing) {
  const document = frame.contentDocument
  if (!document) return
  const root = document.documentElement
  root.style.transform = ''
  root.style.transformOrigin = ''
  root.style.overflow = sizing === 'fit' ? 'hidden' : 'auto'
  if (sizing === 'readable') return

  const contentWidth = root.scrollWidth
  const contentHeight = root.scrollHeight
  if (!contentWidth || !contentHeight || !frame.clientWidth || !frame.clientHeight) return
  const scale = Math.min(frame.clientWidth / contentWidth, frame.clientHeight / contentHeight, 1)
  root.style.transformOrigin = 'top center'
  root.style.transform = `scale(${scale})`
}

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
  const [previewing, setPreviewing] = React.useState(false)
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [previewAudience, setPreviewAudience] = React.useState<PreviewAudience>('internal')
  const [previewSizing, setPreviewSizing] = React.useState<PreviewSizing>('readable')
  const [preview, setPreview] = React.useState<PreviewResponse | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const value = await readApiResultOrThrow<AppointmentEmailSettings>('/api/appointments/email-settings')
      setSettings(value)
    } catch (err) {
      logger.error('appointment email settings load failed', { err })
      flash(translate('appointments.config.email.errors.loadFailed', 'Failed to load appointment email settings.'), 'error')
    } finally {
      setLoading(false)
    }
  }, [translate])

  React.useEffect(() => { void load() }, [load, scopeVersion])

  const updateDelivery = (name: DeliveryField, value: string) => {
    setSettings((current) => ({ ...current, [name]: value }))
  }

  const updateCustomization = <Key extends keyof AppointmentEmailCustomization>(
    name: Key,
    value: AppointmentEmailCustomization[Key],
  ) => {
    setSettings((current) => ({
      ...current,
      customization: { ...current.customization, [name]: value },
    }))
  }

  const save = async (event?: React.FormEvent) => {
    event?.preventDefault()
    setSaving(true)
    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall('/api/appointments/email-settings', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(settings),
          })
          if (!call.ok) {
            await raiseCrudError(call.response, translate('appointments.config.email.errors.saveFailed', 'Failed to save appointment email settings.'))
          }
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

  const openPreview = async () => {
    setPreviewing(true)
    try {
      const result = await readApiResultOrThrow<PreviewResponse>('/api/appointments/email-settings/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      })
      setPreview(result)
      setPreviewOpen(true)
    } catch (err) {
      logger.error('appointment email preview failed', { err })
      flash(translate('appointments.config.email.errors.previewFailed', 'Failed to render email preview.'), 'error')
    } finally {
      setPreviewing(false)
    }
  }

  const openEmailOnly = (audience: PreviewAudience) => {
    const html = preview?.[audience].html
    if (!html) return
    const emailUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    const opened = window.open(emailUrl, '_blank')
    if (!opened) {
      URL.revokeObjectURL(emailUrl)
      flash(translate('appointments.config.email.errors.popupBlocked', 'Allow pop-ups to open the email preview.'), 'error')
      return
    }
    opened.opener = null
    window.setTimeout(() => URL.revokeObjectURL(emailUrl), 300_000)
  }

  return (
    <section className="space-y-5 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{translate('appointments.config.email.title', 'Public booking emails')}</h2>
            <Badge variant="neutral" size="sm">{translate('appointments.config.email.scope', 'Tenant-wide')}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {translate('appointments.config.email.description', 'Control delivery and appearance for emails sent after a public booking request.')}
          </p>
        </div>
        <Button type="button" variant="outline" disabled={loading || previewing} onClick={() => { void openPreview() }}>
          <Eye aria-hidden="true" />
          {previewing
            ? translate('appointments.config.email.actions.rendering', 'Rendering…')
            : translate('appointments.config.email.actions.preview', 'Preview emails')}
        </Button>
      </div>

      {loading ? (
        <LoadingMessage label={translate('appointments.config.email.loading', 'Loading email settings…')} />
      ) : (
        <form
          className="space-y-6"
          onSubmit={(event) => { void save(event) }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              if (!saving) void save()
            }
          }}
        >
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{translate('appointments.config.email.delivery.title', 'Delivery')}</h3>
              <p className="text-xs text-muted-foreground">{translate('appointments.config.email.delivery.description', 'Choose who receives booking notices and which verified address sends them.')}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {deliveryFields.map((field) => (
                <FormField
                  key={field.name}
                  label={translate(`appointments.config.email.fields.${field.name}`, field.label)}
                  description={translate(`appointments.config.email.help.${field.name}`, field.help)}
                  className={field.name === 'to' ? 'md:col-span-2' : undefined}
                >
                  <Input
                    type={field.inputMode === 'email' ? 'email' : 'text'}
                    value={settings[field.name]}
                    disabled={saving}
                    placeholder={field.inputMode === 'list'
                      ? translate('appointments.config.email.placeholders.recipients', 'name@example.com, team@example.com')
                      : translate('appointments.config.email.placeholders.email', 'name@example.com')}
                    onChange={(event) => updateDelivery(field.name, event.target.value)}
                  />
                </FormField>
              ))}
            </div>
          </div>

          <div className="space-y-3 border-t border-border pt-5">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{translate('appointments.config.email.template.title', 'Email design')}</h3>
              <p className="text-xs text-muted-foreground">{translate('appointments.config.email.template.description', 'Keep the proven original exactly as it is, or create a branded version without changing the booking data table.')}</p>
            </div>
            <SegmentedControl
              value={settings.templateMode}
              onValueChange={(value) => setSettings((current) => ({ ...current, templateMode: value as AppointmentEmailSettings['templateMode'] }))}
              aria-label={translate('appointments.config.email.template.modeLabel', 'Email design mode')}
              disabled={saving}
            >
              <SegmentedControlItem value="original_prive" icon={<LockKeyhole aria-hidden="true" />}>
                {translate('appointments.config.email.template.original', 'Original Privé')}
              </SegmentedControlItem>
              <SegmentedControlItem value="custom" icon={<Palette aria-hidden="true" />}>
                {translate('appointments.config.email.template.custom', 'Customized')}
              </SegmentedControlItem>
            </SegmentedControl>

            {settings.templateMode === 'original_prive' ? (
              <Alert status="success" style="lighter">
                <div className="space-y-1">
                  <p className="font-medium">{translate('appointments.config.email.template.originalTitle', 'Exact original template is active')}</p>
                  <p className="text-sm">{translate('appointments.config.email.template.originalHelp', 'Both emails use the unchanged legacy React Email templates, including the original logo, banner, copy, formatting, links, and booking table.')}</p>
                </div>
              </Alert>
            ) : (
              <CustomTemplateFields
                value={settings.customization}
                disabled={saving}
                translate={translate}
                onChange={updateCustomization}
                onReset={() => setSettings((current) => ({ ...current, customization: cloneDefaults() }))}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" disabled={saving || previewing} onClick={() => { void openPreview() }}>
              <Eye aria-hidden="true" />
              {translate('appointments.config.email.actions.preview', 'Preview emails')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving
                ? translate('appointments.config.email.actions.saving', 'Saving…')
                : translate('appointments.config.email.actions.save', 'Save email settings')}
            </Button>
          </div>
        </form>
      )}

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent size="xl" className="h-5/6 overflow-hidden" disableBodyWrap>
          <DialogHeader>
            <DialogTitle>{translate('appointments.config.email.preview.title', 'Email preview')}</DialogTitle>
            <DialogDescription>{translate('appointments.config.email.preview.description', 'Rendered with realistic sample booking data. Nothing is sent or saved.')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="min-h-0 flex-1 overflow-hidden">
            <Tabs value={previewAudience} onValueChange={(value) => setPreviewAudience(value as PreviewAudience)} className="flex h-full min-h-0 flex-col">
              <TabsList aria-label={translate('appointments.config.email.preview.audienceLabel', 'Preview audience')}>
                <TabsTrigger value="internal">{translate('appointments.config.email.preview.internal', 'Internal team')}</TabsTrigger>
                <TabsTrigger value="customer">{translate('appointments.config.email.preview.customer', 'Customer')}</TabsTrigger>
              </TabsList>
              <div className="flex shrink-0 justify-end pt-2">
                <SegmentedControl
                  value={previewSizing}
                  onValueChange={(value) => setPreviewSizing(value as PreviewSizing)}
                  aria-label={translate('appointments.config.email.preview.sizingLabel', 'Preview size')}
                  size="sm"
                >
                  <SegmentedControlItem value="fit">{translate('appointments.config.email.preview.fit', 'Fit whole email')}</SegmentedControlItem>
                  <SegmentedControlItem value="readable">{translate('appointments.config.email.preview.readable', 'Readable size')}</SegmentedControlItem>
                </SegmentedControl>
              </div>
              {(['internal', 'customer'] as const).map((audience) => (
                <TabsContent key={audience} value={audience} className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-2">
                  <div className="flex shrink-0 items-start justify-between gap-3 rounded-lg border border-border bg-surface-muted p-3">
                    <div className="min-w-0">
                      <p className="text-overline uppercase text-muted-foreground">{translate('appointments.config.email.preview.subject', 'Subject')}</p>
                      <p className="break-words text-sm font-medium text-foreground">{preview?.[audience].subject}</p>
                    </div>
                    <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => openEmailOnly(audience)}>
                      {translate('appointments.config.email.preview.openOnly', 'Open email only')}
                    </Button>
                  </div>
                  <iframe
                    key={`${audience}-${previewSizing}`}
                    className="min-h-0 w-full flex-1 rounded-lg border border-border bg-surface"
                    sandbox="allow-same-origin"
                    srcDoc={preview?.[audience].html ?? ''}
                    title={translate('appointments.config.email.preview.frameTitle', `${audience} booking email preview`)}
                    onLoad={(event) => {
                      const frame = event.currentTarget
                      window.requestAnimationFrame(() => {
                        window.requestAnimationFrame(() => sizeEmailPreview(frame, previewSizing))
                      })
                    }}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </DialogBody>
        </DialogContent>
      </Dialog>

    </section>
  )
}

function CustomTemplateFields({
  value,
  disabled,
  translate,
  onChange,
  onReset,
}: {
  value: AppointmentEmailCustomization
  disabled: boolean
  translate: (key: string, fallback: string) => string
  onChange: <Key extends keyof AppointmentEmailCustomization>(name: Key, value: AppointmentEmailCustomization[Key]) => void
  onReset: () => void
}) {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface-muted p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{translate('appointments.config.email.custom.title', 'Customize from the original')}</p>
          <p className="text-xs text-muted-foreground">{translate('appointments.config.email.custom.description', 'Booking values and the service table remain automatic. Edit only the brand and supporting copy.')}</p>
        </div>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onReset}>
          <RotateCcw aria-hidden="true" />
          {translate('appointments.config.email.actions.reset', 'Reset custom fields')}
        </Button>
      </div>

      <Tabs defaultValue="brand">
        <TabsList aria-label={translate('appointments.config.email.custom.sections', 'Customization sections')}>
          <TabsTrigger value="brand">{translate('appointments.config.email.custom.brandTab', 'Brand & contact')}</TabsTrigger>
          <TabsTrigger value="internal">{translate('appointments.config.email.custom.internalTab', 'Internal email')}</TabsTrigger>
          <TabsTrigger value="customer">{translate('appointments.config.email.custom.customerTab', 'Customer email')}</TabsTrigger>
        </TabsList>

        <TabsContent value="brand" className="pt-3">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label={translate('appointments.config.email.custom.brandName', 'Brand name')}>
              <Input value={value.brandName} disabled={disabled} onChange={(event) => onChange('brandName', event.target.value)} />
            </FormField>
            <FormField label={translate('appointments.config.email.custom.accentColor', 'Accent color')} description={translate('appointments.config.email.custom.accentColorHelp', 'Used for headings, buttons, and highlighted sections in custom emails.')}>
              <ColorPicker value={value.accentColor} disabled={disabled} onChange={(color) => onChange('accentColor', color)} aria-label={translate('appointments.config.email.custom.accentColor', 'Accent color')} />
            </FormField>
            <FormField label={translate('appointments.config.email.custom.logoUrl', 'Internal email logo URL')}>
              <Input type="url" value={value.logoUrl} disabled={disabled} onChange={(event) => onChange('logoUrl', event.target.value)} />
            </FormField>
            <FormField label={translate('appointments.config.email.custom.bannerUrl', 'Customer email banner URL')}>
              <Input type="url" value={value.bannerUrl} disabled={disabled} onChange={(event) => onChange('bannerUrl', event.target.value)} />
            </FormField>
            <FormField label={translate('appointments.config.email.custom.contactPhone', 'Contact phone')}>
              <Input value={value.contactPhone} disabled={disabled} onChange={(event) => onChange('contactPhone', event.target.value)} />
            </FormField>
            <FormField label={translate('appointments.config.email.custom.contactEmail', 'Contact email')}>
              <Input type="email" value={value.contactEmail} disabled={disabled} onChange={(event) => onChange('contactEmail', event.target.value)} />
            </FormField>
            <FormField className="md:col-span-2" label={translate('appointments.config.email.custom.dashboardUrl', 'Booking dashboard URL')}>
              <Input type="url" value={value.dashboardUrl} disabled={disabled} onChange={(event) => onChange('dashboardUrl', event.target.value)} />
            </FormField>
          </div>
        </TabsContent>

        <TabsContent value="internal" className="pt-3">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField className="md:col-span-2" label={translate('appointments.config.email.custom.internalSubjectPrefix', 'Subject prefix')} description={translate('appointments.config.email.custom.internalSubjectHelp', 'Customer name and booking location are appended automatically.')}>
              <Input value={value.internalSubjectPrefix} disabled={disabled} onChange={(event) => onChange('internalSubjectPrefix', event.target.value)} />
            </FormField>
            <FormField label={translate('appointments.config.email.custom.internalHeadline', 'Headline')}>
              <Input value={value.internalHeadline} disabled={disabled} onChange={(event) => onChange('internalHeadline', event.target.value)} />
            </FormField>
            <FormField label={translate('appointments.config.email.custom.internalCtaLabel', 'Dashboard button label')}>
              <Input value={value.internalCtaLabel} disabled={disabled} onChange={(event) => onChange('internalCtaLabel', event.target.value)} />
            </FormField>
            <FormField className="md:col-span-2" label={translate('appointments.config.email.custom.internalIntro', 'Introduction')}>
              <Textarea value={value.internalIntro} disabled={disabled} maxLength={2000} showCount onChange={(event) => onChange('internalIntro', event.target.value)} />
            </FormField>
            <FormField className="md:col-span-2" label={translate('appointments.config.email.custom.internalPreparation', 'Preparation note')}>
              <Textarea value={value.internalPreparation} disabled={disabled} maxLength={2000} showCount onChange={(event) => onChange('internalPreparation', event.target.value)} />
            </FormField>
            <FormField className="md:col-span-2" label={translate('appointments.config.email.custom.internalFooter', 'Footer')}>
              <Textarea value={value.internalFooter} disabled={disabled} maxLength={2000} showCount onChange={(event) => onChange('internalFooter', event.target.value)} />
            </FormField>
          </div>
        </TabsContent>

        <TabsContent value="customer" className="pt-3">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField className="md:col-span-2" label={translate('appointments.config.email.custom.customerSubject', 'Subject')}>
              <Input value={value.customerSubject} disabled={disabled} onChange={(event) => onChange('customerSubject', event.target.value)} />
            </FormField>
            <FormField className="md:col-span-2" label={translate('appointments.config.email.custom.customerIntro', 'Introduction')}>
              <Textarea value={value.customerIntro} disabled={disabled} maxLength={2000} showCount onChange={(event) => onChange('customerIntro', event.target.value)} />
            </FormField>
            <FormField className="md:col-span-2" label={translate('appointments.config.email.custom.customerPendingNotice', 'Pending confirmation notice')}>
              <Textarea value={value.customerPendingNotice} disabled={disabled} maxLength={2000} showCount onChange={(event) => onChange('customerPendingNotice', event.target.value)} />
            </FormField>
            <FormField label={translate('appointments.config.email.custom.healthSafetyTitle', 'Health & safety heading')}>
              <Input value={value.healthSafetyTitle} disabled={disabled} onChange={(event) => onChange('healthSafetyTitle', event.target.value)} />
            </FormField>
            <FormField label={translate('appointments.config.email.custom.updateTitle', 'Update booking heading')}>
              <Input value={value.updateTitle} disabled={disabled} onChange={(event) => onChange('updateTitle', event.target.value)} />
            </FormField>
            <FormField className="md:col-span-2" label={translate('appointments.config.email.custom.healthSafetyBody', 'Health & safety copy')}>
              <Textarea value={value.healthSafetyBody} disabled={disabled} maxLength={2000} showCount onChange={(event) => onChange('healthSafetyBody', event.target.value)} />
            </FormField>
            <FormField className="md:col-span-2" label={translate('appointments.config.email.custom.updateBody', 'Update booking copy')} description={translate('appointments.config.email.custom.updateBodyHelp', 'Contact phone and email are added automatically after this text.')}>
              <Textarea value={value.updateBody} disabled={disabled} maxLength={2000} showCount onChange={(event) => onChange('updateBody', event.target.value)} />
            </FormField>
            <FormField label={translate('appointments.config.email.custom.closingText', 'Closing line')}>
              <Textarea value={value.closingText} disabled={disabled} maxLength={2000} showCount onChange={(event) => onChange('closingText', event.target.value)} />
            </FormField>
            <FormField label={translate('appointments.config.email.custom.signatureText', 'Signature')} description={translate('appointments.config.email.custom.signatureHelp', 'Line breaks are preserved.')}>
              <Textarea value={value.signatureText} disabled={disabled} maxLength={2000} showCount onChange={(event) => onChange('signatureText', event.target.value)} />
            </FormField>
            <FormField className="md:col-span-2" label={translate('appointments.config.email.custom.customerFooter', 'Footer')}>
              <Textarea value={value.customerFooter} disabled={disabled} maxLength={2000} showCount onChange={(event) => onChange('customerFooter', event.target.value)} />
            </FormField>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
