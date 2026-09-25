'use client'

import * as React from 'react'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { cn } from '@open-mercato/shared/lib/utils'
import { FormFieldLabel } from '@open-mercato/ui/backend/forms/FormSection'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DETAIL_DIALOG_BODY } from './dialogChrome'

export interface ComposeEmailChannel {
  id: string
  displayName: string
  externalIdentifier?: string | null
  providerKey: 'gmail' | 'imap' | string
  isPrimary?: boolean
}

export interface ComposeEmailValues {
  userChannelId: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body: string
  bodyFormat: 'text' | 'html'
  visibility: 'private' | 'shared'
  inReplyTo?: string
  references?: string[]
  /** When replying, the messages.message id of the parent so the reply joins its thread. */
  parentMessageId?: string
}

export interface ComposeEmailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultRecipient?: string | null
  channels: ComposeEmailChannel[]
  replyTo?: {
    inReplyTo?: string
    references?: string[]
    to: string[]
    cc?: string[]
    subject: string
    parentMessageId?: string
  } | null
  onSend: (values: ComposeEmailValues) => Promise<{ messageId: string | null }>
}

function parseRecipients(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function defaultChannelId(channels: ComposeEmailChannel[]): string {
  const primary = channels.find((c) => c.isPrimary)
  return primary?.id ?? channels[0]?.id ?? ''
}

/** Single source of truth for the dialog's seeded form values (reply prefill, default recipient, primary channel). */
function deriveComposeInitialState(
  replyTo: ComposeEmailDialogProps['replyTo'],
  defaultRecipient: string | null | undefined,
  channels: ComposeEmailChannel[],
): { to: string; cc: string; showCc: boolean; subject: string; channelId: string } {
  const cc = replyTo?.cc && replyTo.cc.length > 0 ? replyTo.cc.join(', ') : ''
  return {
    to: replyTo ? replyTo.to.join(', ') : (defaultRecipient ?? ''),
    cc,
    showCc: Boolean(cc),
    subject: replyTo?.subject ?? '',
    channelId: defaultChannelId(channels),
  }
}

export function ComposeEmailDialog({
  open,
  onOpenChange,
  channels,
  defaultRecipient,
  replyTo,
  onSend,
}: ComposeEmailDialogProps) {
  const t = useT()

  const initial = React.useMemo(
    () => deriveComposeInitialState(replyTo, defaultRecipient, channels),
    [replyTo, defaultRecipient, channels],
  )

  const [to, setTo] = React.useState(initial.to)
  const [showCc, setShowCc] = React.useState(initial.showCc)
  const [cc, setCc] = React.useState(initial.cc)
  const [subject, setSubject] = React.useState(initial.subject)
  const [body, setBody] = React.useState('')
  const [visibility, setVisibility] = React.useState<'private' | 'shared'>('private')
  const [channelId, setChannelId] = React.useState(initial.channelId)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Reset the form whenever the dialog (re)opens or its seed inputs change.
  React.useEffect(() => {
    if (!open) return
    const next = deriveComposeInitialState(replyTo, defaultRecipient, channels)
    setTo(next.to)
    setCc(next.cc)
    setShowCc(next.showCc)
    setSubject(next.subject)
    setBody('')
    setVisibility('private')
    setChannelId(next.channelId)
    setError(null)
    setBusy(false)
  }, [open, replyTo, defaultRecipient, channels])

  const toList = React.useMemo(() => parseRecipients(to), [to])
  const isSendDisabled =
    busy ||
    toList.length === 0 ||
    subject.trim().length === 0 ||
    body.trim().length === 0 ||
    !channelId

  const handleSend = React.useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const ccList = showCc ? parseRecipients(cc) : undefined
      const values: ComposeEmailValues = {
        userChannelId: channelId,
        to: toList,
        cc: ccList && ccList.length > 0 ? ccList : undefined,
        subject: subject.trim(),
        body: body.trim(),
        bodyFormat: 'text',
        visibility,
        inReplyTo: replyTo?.inReplyTo,
        references: replyTo?.references,
        parentMessageId: replyTo?.parentMessageId,
      }
      await onSend(values)
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [showCc, cc, channelId, toList, subject, body, visibility, replyTo, onSend, onOpenChange])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        if (!isSendDisabled) {
          void handleSend()
        }
      }
    },
    [isSendDisabled, handleSend],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {replyTo
              ? t('customers.email.compose.replyTitle', 'Reply')
              : t('customers.email.compose.title', 'Compose email')}
          </DialogTitle>
        </DialogHeader>

        <DialogBody data-dialog-form="true" className={cn('flex flex-col gap-6', DETAIL_DIALOG_BODY)}>
          {/* To */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <FormFieldLabel htmlFor="compose-to" className="mb-0" required>
                {t('customers.email.compose.to', 'To')}
              </FormFieldLabel>
              {!showCc && (
                <Button
                  type="button"
                  variant="link"
                  size="2xs"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setShowCc(true)}
                  aria-label={t('customers.email.compose.addCc.ariaLabel', 'Add Cc recipients')}
                >
                  {t('customers.email.compose.addCc', '+ Cc')}
                </Button>
              )}
            </div>
            <Input
              id="compose-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={t('customers.email.compose.toPlaceholder', 'recipient@example.com')}
              autoComplete="off"
            />
          </div>

          {/* Cc (collapsible) */}
          {showCc && (
            <div className="flex flex-col gap-2.5">
              <FormFieldLabel htmlFor="compose-cc" className="mb-0">
                {t('customers.email.compose.cc', 'Cc')}
              </FormFieldLabel>
              <Input
                id="compose-cc"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder={t('customers.email.compose.ccPlaceholder', 'cc@example.com')}
                autoComplete="off"
              />
            </div>
          )}

          {/* Subject */}
          <div className="flex flex-col gap-2.5">
            <FormFieldLabel htmlFor="compose-subject" className="mb-0" required>
              {t('customers.email.compose.subject', 'Subject')}
            </FormFieldLabel>
            <Input
              id="compose-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('customers.email.compose.subjectPlaceholder', 'Email subject')}
            />
          </div>

          {/* Body */}
          <div className="flex flex-col gap-2.5">
            <FormFieldLabel htmlFor="compose-body" className="mb-0" required>
              {t('customers.email.compose.body', 'Body')}
            </FormFieldLabel>
            <Textarea
              id="compose-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('customers.email.compose.bodyPlaceholder', 'Write your message...')}
              rows={8}
            />
          </div>

          {/* Visibility */}
          <div className="flex flex-col gap-2.5">
            <FormFieldLabel className="mb-0">
              {t('customers.email.compose.visibility', 'Visibility')}
            </FormFieldLabel>
            <RadioGroup
              value={visibility}
              onValueChange={(val) => setVisibility(val as 'private' | 'shared')}
              className="flex flex-row gap-4"
            >
              <RadioField
                value="private"
                label={t('customers.email.compose.visibilityPrivate', 'Private to me')}
              />
              <RadioField
                value="shared"
                label={t('customers.email.compose.visibilityShared', 'Visible to teammates')}
              />
            </RadioGroup>
          </div>

          {/* Send as (channel selector) */}
          {channels.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <FormFieldLabel htmlFor="compose-channel" className="mb-0" required>
                {t('customers.email.compose.sendAs', 'Send as')}
              </FormFieldLabel>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger id="compose-channel">
                  <SelectValue placeholder={t('customers.email.compose.selectChannel', 'Select account')} />
                </SelectTrigger>
                <SelectContent>
                  {channels.map((ch) => (
                    <SelectItem key={ch.id} value={ch.id}>
                      {ch.displayName}
                      {ch.externalIdentifier ? ` (${ch.externalIdentifier})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Always laid out, so an error appearing moves nothing. */}
          <p className="min-h-5 text-sm text-status-error-text" role="alert">
            {error ?? ''}
          </p>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="soft"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t('customers.email.compose.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSend()}
            disabled={isSendDisabled}
          >
            {busy
              ? t('customers.email.compose.sending', 'Sending...')
              : t('customers.email.compose.send', 'Send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
