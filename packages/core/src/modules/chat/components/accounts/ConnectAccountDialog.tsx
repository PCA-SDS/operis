"use client"

import * as React from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ChatMessagingAccountDto } from '../../data/types'
import { accountReasonText } from './accountText'
import { QrCode } from './QrCode'
import { useAccount, useAccountMutations } from './useAccounts'

type Method = 'qr' | 'phone'

export type ConnectAccountDialogProps = {
  open: boolean
  onClose: () => void
  account: ChatMessagingAccountDto | null
}

/** `ABCD1234` → `ABCD-1234`, the way WhatsApp prints a pairing code. */
function formatPairingCode(code: string): string {
  const compact = code.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : code
}

/**
 * Link a WhatsApp number to an account, the way WhatsApp Web is linked: scan a
 * QR code in WhatsApp → Linked devices, or type an 8-character code there.
 *
 * The page never talks to WhatsApp. It asks Operis to start the login, then
 * re-reads the account while it connects: new codes arrive on it as WhatsApp
 * rotates them, and so does the outcome. Closing cancels a login that has not
 * finished, so no code stays valid behind a closed dialog.
 */
export function ConnectAccountDialog({ open, onClose, account }: ConnectAccountDialogProps) {
  const t = useT()
  const [method, setMethod] = React.useState<Method>('qr')
  const [phone, setPhone] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [started, setStarted] = React.useState(false)
  const { connect, cancelConnect } = useAccountMutations()
  const live = useAccount(open && account ? account.id : null)
  const current = live.data ?? account

  React.useEffect(() => {
    if (!open) return
    setMethod('qr')
    setPhone('')
    setError(null)
    setStarted(false)
  }, [open])

  const status = current?.status ?? 'pending'
  const connecting = started && status === 'connecting'
  const connected = started && status === 'connected'
  const failed = started && (status === 'failed' || status === 'disconnected' || status === 'pending')
  const step = connecting ? current?.loginStep ?? null : null

  const start = React.useCallback(async () => {
    if (!account || connect.isPending) return
    if (method === 'phone' && phone.trim().length === 0) return
    setError(null)
    try {
      await connect.mutateAsync({
        id: account.id,
        request: { flow: method, phoneNumber: method === 'phone' ? phone.trim() : null },
      })
      setStarted(true)
      void live.refetch()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : t('chat.accounts.connect.startFailed', "Couldn't start connecting."),
      )
    }
  }, [account, connect, live, method, phone, t])

  const close = React.useCallback(async () => {
    if (account && current?.status === 'connecting') {
      try {
        await cancelConnect.mutateAsync(account.id)
      } catch {
        // Closing still closes; the code simply expires on its own.
      }
    }
    onClose()
  }, [account, cancelConnect, current?.status, onClose])

  const idle = !started || failed

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : void close())}>
      <DialogContent
        size="default"
        className="flex flex-col overflow-hidden"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && idle) {
            event.preventDefault()
            void start()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t('chat.accounts.connect.title', 'Connect {name}', { name: account?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'chat.accounts.connect.description',
              'Link the WhatsApp number to Operis the way you would link WhatsApp Web.',
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {connected ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center" data-testid="chat-account-connected">
              <CheckCircle2 className="size-10 text-status-success-icon" aria-hidden="true" />
              <p className="text-base font-semibold text-foreground">
                {t('chat.accounts.connect.done', 'Connected')}
              </p>
              <p className="text-sm text-muted-foreground">
                {current?.remoteHandle
                  ? t('chat.accounts.connect.doneAs', 'Chats on {number} will appear in Chat for the team.', {
                      number: current.remoteHandle,
                    })
                  : t('chat.accounts.connect.doneGeneric', 'Chats on this number will appear in Chat for the team.')}
              </p>
            </div>
          ) : connecting ? (
            <ConnectingStep step={step} />
          ) : (
            <>
              <Alert status="warning" style="lighter">
                <AlertTitle>{t('chat.accounts.connect.noticeTitle', 'Use a number meant for business')}</AlertTitle>
                <AlertDescription>
                  {t(
                    'chat.accounts.connect.notice',
                    'Operis connects as a linked device, like WhatsApp Web. WhatsApp can restrict numbers that send bulk or automated messages, so use a dedicated number and keep the phone online.',
                  )}
                </AlertDescription>
              </Alert>

              {failed && current?.statusReason ? (
                <ErrorMessage label={accountReasonText(t, current.statusReason) ?? ''} />
              ) : null}
              {error ? <ErrorMessage label={error} /> : null}

              <SegmentedControl
                value={method}
                onValueChange={(next) => setMethod(next as Method)}
                fullWidth
                tone="inset"
                aria-label={t('chat.accounts.connect.methodLabel', 'How to connect')}
              >
                <SegmentedControlItem value="qr">{t('chat.accounts.connect.methodQr', 'Scan a QR code')}</SegmentedControlItem>
                <SegmentedControlItem value="phone">
                  {t('chat.accounts.connect.methodPhone', 'Use a code instead')}
                </SegmentedControlItem>
              </SegmentedControl>

              {method === 'phone' ? (
                <FormField
                  label={t('chat.accounts.connect.phoneLabel', 'WhatsApp phone number')}
                  description={t(
                    'chat.accounts.connect.phoneHint',
                    'In international format, with the country code, e.g. +49 151 23456789.',
                  )}
                  required
                >
                  <Input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phone}
                    autoFocus
                    maxLength={32}
                    disabled={connect.isPending}
                    placeholder="+49 151 23456789"
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </FormField>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t(
                    'chat.accounts.connect.qrHint',
                    "You'll scan a code with the phone that has this WhatsApp number.",
                  )}
                </p>
              )}
            </>
          )}
        </DialogBody>

        <DialogFooter bordered>
          {connected ? (
            <Button type="button" onClick={onClose}>
              {t('chat.actions.close', 'Close')}
            </Button>
          ) : (
            <>
              <Button type="button" variant="soft" onClick={() => void close()} disabled={cancelConnect.isPending}>
                {t('chat.actions.cancel', 'Cancel')}
              </Button>
              {idle ? (
                <Button
                  type="button"
                  onClick={() => void start()}
                  disabled={connect.isPending || (method === 'phone' && phone.trim().length === 0)}
                >
                  {connect.isPending
                    ? t('chat.accounts.connect.starting', 'Starting…')
                    : failed
                      ? t('chat.accounts.connect.retry', 'Try again')
                      : t('chat.accounts.connect.start', 'Connect')}
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConnectingStep({ step }: { step: ChatMessagingAccountDto['loginStep'] }) {
  const t = useT()
  if (step?.kind === 'qr' && step.data) {
    return (
      <div className="flex flex-col items-center gap-4 py-2" data-testid="chat-account-qr">
        <QrCode value={step.data} label={t('chat.accounts.connect.qrLabel', 'WhatsApp QR code')} />
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t('chat.accounts.connect.qrStep1', 'Open WhatsApp on the phone.')}</li>
          <li>{t('chat.accounts.connect.qrStep2', 'Go to Settings → Linked devices → Link a device.')}</li>
          <li>{t('chat.accounts.connect.qrStep3', 'Point the phone at this code. It refreshes on its own.')}</li>
        </ol>
      </div>
    )
  }
  if (step?.kind === 'code' && step.data) {
    return (
      <div className="flex flex-col items-center gap-4 py-2" data-testid="chat-account-code">
        <p className="font-mono text-3xl font-semibold tracking-widest text-foreground" aria-live="polite">
          {formatPairingCode(step.data)}
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t('chat.accounts.connect.codeStep1', 'On the phone, open WhatsApp → Settings → Linked devices.')}</li>
          <li>{t('chat.accounts.connect.codeStep2', 'Tap Link a device, then Link with phone number instead.')}</li>
          <li>{t('chat.accounts.connect.codeStep3', 'Type this code.')}</li>
        </ol>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-3 py-8" aria-busy="true">
      <Spinner size="lg" />
      <p className="text-sm text-muted-foreground">
        {t('chat.accounts.connect.waiting', 'Waiting for WhatsApp…')}
      </p>
    </div>
  )
}
