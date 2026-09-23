'use client'

import * as React from 'react'
import { Mail, MailOpen, Send, Trash2 } from 'lucide-react'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useInvoiceT as useT } from '../../../lib/useInvoiceT'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'

type InvoiceSendPanelInvoice = {
  id: string
  companyId: string | null
  partnerName: string | null
  buyerName: string | null
  invoiceSymbol: string | null
  invoiceNumber: string | null
  lastSentAt: string | null
  openedAt: string | null
  updatedAt: string | null
}

type CompanyEmail = {
  id: string
  companyId: string
  email: string
  updatedAt: string | null
}

type CompanyEmailListResponse = { items: CompanyEmail[] }
type MutationError = { error?: string; code?: string }
type SendResponse = { ok: true; invoice: InvoiceSendPanelInvoice }

type InvoiceSendPanelProps = {
  invoice: InvoiceSendPanelInvoice
  onSent: () => Promise<void>
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function displayDateTime(value: string, fallback: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString()
}

function responseError(payload: MutationError | null, fallback: string): string {
  return typeof payload?.error === 'string' && payload.error.trim() ? payload.error : fallback
}

export function InvoiceSendPanel({ invoice, onSent }: InvoiceSendPanelProps) {
  const t = useT()
  const { payload, isReady } = useBackendChrome()
  const canSend = isReady && (!payload || hasFeature(payload.grantedFeatures, 'invoice.manage'))
  const [open, setOpen] = React.useState(false)
  const [email, setEmail] = React.useState('')
  const [emails, setEmails] = React.useState<CompanyEmail[]>([])
  const [emailError, setEmailError] = React.useState<string | null>(null)
  const [listError, setListError] = React.useState<string | null>(null)
  const [sendError, setSendError] = React.useState<string | null>(null)
  const [isLoadingEmails, setIsLoadingEmails] = React.useState(false)
  const [removingId, setRemovingId] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation, isPending: isSending } = useGuardedMutation({
    contextId: 'invoice.detail.send',
  })
  const { runMutation: runEmailMutation, retryLastMutation: retryEmailMutation } = useGuardedMutation({
    contextId: 'invoice.detail.company-email.remove',
  })

  const invoiceLabel = [invoice.invoiceSymbol, invoice.invoiceNumber].filter(Boolean).join(' ·')
    || t('invoice.detail.untitled')
  const companyName = invoice.partnerName ?? invoice.buyerName ?? t('invoice.send.customerFallback')
  const sentLabel = invoice.lastSentAt
    ? displayDateTime(invoice.lastSentAt, t('invoice.send.unknownDate'))
    : null
  const openedLabel = invoice.openedAt
    ? displayDateTime(invoice.openedAt, t('invoice.send.unknownDate'))
    : null

  const loadEmails = React.useCallback(async () => {
    if (!invoice.companyId) {
      setEmails([])
      setListError(null)
      return
    }
    setIsLoadingEmails(true)
    setListError(null)
    try {
      const call = await apiCall<CompanyEmailListResponse>(
        `/api/invoice/company-emails?companyId=${encodeURIComponent(invoice.companyId)}`,
        undefined,
        { fallback: { items: [] } },
      )
      if (!call.ok) {
        setListError(t('invoice.send.recipientsLoadFailed'))
        return
      }
      setEmails(call.result?.items ?? [])
    } catch {
      setListError(t('invoice.send.recipientsLoadFailed'))
    } finally {
      setIsLoadingEmails(false)
    }
  }, [invoice.companyId, t])

  React.useEffect(() => {
    if (!open) return
    void loadEmails()
  }, [loadEmails, open])

  const resetDialog = React.useCallback(() => {
    setEmail('')
    setEmailError(null)
    setListError(null)
    setSendError(null)
  }, [])

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    if (!nextOpen && (isSending || removingId)) return
    setOpen(nextOpen)
    if (!nextOpen) resetDialog()
  }, [isSending, removingId, resetDialog])

  const removeEmail = React.useCallback(async (entry: CompanyEmail) => {
    if (!invoice.companyId) return
    setRemovingId(entry.id)
    setListError(null)
    try {
      await runEmailMutation({
        operation: async () => {
          const call = await apiCall<{ ok: true }>(
            `/api/invoice/company-emails/${encodeURIComponent(entry.id)}?companyId=${encodeURIComponent(invoice.companyId!)}`,
            { method: 'DELETE' },
            { fallback: null },
          )
          if (!call.ok) {
            throw new Error(responseError(call.result as MutationError | null, t('invoice.send.recipientRemoveFailed')))
          }
          return call.result
        },
        context: { invoiceId: invoice.id, companyId: invoice.companyId, retryLastMutation: retryEmailMutation },
        mutationPayload: { companyId: invoice.companyId, emailId: entry.id },
      })
      setEmails((current) => current.filter((item) => item.id !== entry.id))
    } catch {
      setListError(t('invoice.send.recipientRemoveFailed'))
    } finally {
      setRemovingId(null)
    }
  }, [invoice.companyId, invoice.id, retryEmailMutation, runEmailMutation, t])

  const submit = React.useCallback(async () => {
    if (isSending || removingId) return
    const recipient = email.trim()
    if (!EMAIL_PATTERN.test(recipient)) {
      setEmailError(t('invoice.send.invalidRecipient'))
      return
    }
    setEmailError(null)
    setSendError(null)
    try {
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(invoice.updatedAt),
            () => apiCall<SendResponse>(
              `/api/invoice/invoices/${encodeURIComponent(invoice.id)}/send`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: recipient }),
              },
              { fallback: null },
            ),
          )
          if (!call.ok || !call.result?.ok) {
            if (surfaceRecordConflict({ status: call.status, body: call.result }, t)) {
              throw new Error(t('invoice.send.conflict'))
            }
            throw new Error(responseError(call.result as MutationError | null, t('invoice.send.failed')))
          }
          return call.result
        },
        context: { invoiceId: invoice.id, companyId: invoice.companyId, retryLastMutation },
        mutationPayload: { email: recipient },
      })
      flash(t('invoice.send.success', { email: recipient }), 'success')
      setOpen(false)
      resetDialog()
      await onSent()
    } catch (error) {
      setSendError(error instanceof Error && error.message ? error.message : t('invoice.send.failed'))
    }
  }, [email, invoice.companyId, invoice.id, invoice.updatedAt, isSending, onSent, removingId, resetDialog, retryLastMutation, runMutation, t])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLFormElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      if (!isSending && !removingId) void submit()
    }
  }, [isSending, removingId, submit])

  if (!canSend) return null

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('invoice.send.sectionTitle')}
          </h2>
          {sentLabel ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                {t('invoice.send.lastSent', { date: sentLabel })}
              </p>
              <Badge variant={openedLabel ? 'success' : 'neutral'}>
                {openedLabel ? <MailOpen className="size-4" aria-hidden="true" /> : <Mail className="size-4" aria-hidden="true" />}
                {openedLabel
                  ? t('invoice.send.opened', { date: openedLabel })
                  : t('invoice.send.notOpened')}
              </Badge>
            </div>
          ) : (
            <p className="text-sm font-medium text-foreground">{t('invoice.send.notSent')}</p>
          )}
        </div>
      </div>
      <Button type="button" className="mt-4 w-full" onClick={() => setOpen(true)}>
        <Send className="size-4" aria-hidden="true" />
        {invoice.lastSentAt ? t('invoice.send.resendAction') : t('invoice.send.sendAction')}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent dismissible={!isSending && !removingId}>
          <DialogHeader>
            <DialogTitle>{t('invoice.send.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('invoice.send.dialogDescription', { invoice: invoiceLabel, company: companyName })}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!isSending && !removingId) void submit()
            }}
            onKeyDown={handleKeyDown}
          >
            <div className="space-y-1.5">
              <Label className="flex-col items-stretch gap-1.5">
                <span>{t('invoice.send.recipientLabel')} <span className="text-status-error-icon" aria-hidden="true">*</span></span>
              <Input
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setEmailError(null)
                  setSendError(null)
                }}
                placeholder={t('invoice.send.recipientPlaceholder')}
                autoFocus
                disabled={isSending || Boolean(removingId)}
              />
              </Label>
              {emailError ? <p role="alert" className="text-xs text-status-error-text">{emailError}</p> : null}
            </div>

            {isLoadingEmails ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner size="sm" />
                {t('invoice.send.recipientsLoading')}
              </div>
            ) : null}

            {!isLoadingEmails && invoice.companyId && emails.length > 0 ? (
              <div className="space-y-2 pt-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('invoice.send.rememberedRecipients', { company: companyName })}
                </p>
                <ul className="space-y-1">
                  {emails.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-w-0 flex-1 truncate text-left text-sm text-foreground"
                        onClick={() => {
                          setEmail(entry.email)
                          setEmailError(null)
                          setSendError(null)
                        }}
                        disabled={isSending || Boolean(removingId)}
                      >
                        {entry.email}
                      </Button>
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('invoice.send.removeRecipient', { email: entry.email })}
                        title={t('invoice.send.removeRecipient', { email: entry.email })}
                        disabled={isSending || Boolean(removingId)}
                        onClick={() => void removeEmail(entry)}
                      >
                        {removingId === entry.id ? <Spinner size="sm" /> : <Trash2 className="size-4" aria-hidden="true" />}
                      </IconButton>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {listError ? (
              <Alert
                status="warning"
                style="lighter"
                action={<Button type="button" variant="ghost" size="sm" onClick={() => void loadEmails()}>{t('invoice.actions.retry')}</Button>}
              >
                {listError}
              </Alert>
            ) : null}
            {sendError ? <Alert status="error" style="lighter">{sendError}</Alert> : null}

            <DialogFooter>
              <Button type="button" variant="soft" disabled={isSending || Boolean(removingId)} onClick={() => handleOpenChange(false)}>
                {t('invoice.send.cancelAction')}
              </Button>
              <Button type="submit" disabled={isSending || Boolean(removingId)}>
                {isSending ? <Spinner size="sm" /> : <Send className="size-4" aria-hidden="true" />}
                {isSending ? t('invoice.send.sendingAction') : t('invoice.send.confirmAction')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
