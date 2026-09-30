"use client"

import * as React from 'react'
import { ArrowRightLeft, MessageCircle, ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ChatMessagingAccountDto } from '../../data/types'
import { networkLabel } from '../externalNetwork'
import { ConnectAccountDialog } from './ConnectAccountDialog'
import { MoveChatDialog } from './MoveChatDialog'
import { accountReasonText, accountStatusLabel, accountStatusVariant } from './accountText'
import { useAccountList, useAccountMutations } from './useAccounts'

const PRIMARY_NETWORK = 'whatsapp'

/**
 * `/backend/profile/whatsapp` — an employee's own WhatsApp.
 *
 * Connected the way WhatsApp Web is, and private by default: nothing on it
 * comes into Operis until its owner moves a chat to the company. The moved
 * chat is then a client conversation they own and can hand over, and replies
 * leave from their number.
 */
export function PersonalWhatsApp() {
  const t = useT()
  const list = useAccountList()
  const { create, disconnect, remove } = useAccountMutations()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [connecting, setConnecting] = React.useState<ChatMessagingAccountDto | null>(null)
  const [moving, setMoving] = React.useState(false)

  const account = (list.data?.items ?? []).find((item) => item.ownerType === 'user' && item.network === PRIMARY_NETWORK) ?? null
  const available = Boolean(list.data?.personalAccounts && list.data.networks.includes(PRIMARY_NETWORK))

  const startConnect = async () => {
    if (account) {
      setConnecting(account)
      return
    }
    try {
      const created = await create.mutateAsync({ network: PRIMARY_NETWORK, ownerType: 'user', memberUserIds: [] })
      setConnecting(created)
    } catch (error) {
      flash(error instanceof Error ? error.message : t('chat.personal.createFailed', "Couldn't set up your WhatsApp."), 'error')
    }
  }

  const askDisconnect = async (target: ChatMessagingAccountDto) => {
    try {
      await confirm({
        title: t('chat.personal.disconnect.title', 'Disconnect your WhatsApp?'),
        text: t(
          'chat.personal.disconnect.text',
          'WhatsApp removes Operis from Linked devices. Chats you moved stay with the company, but nobody can reply in them until you connect again.',
        ),
        confirmText: t('chat.accounts.disconnect.confirm', 'Disconnect'),
        variant: 'destructive',
        onConfirm: () => disconnect.mutateAsync(target),
      })
    } catch (error) {
      flash(error instanceof Error ? error.message : t('chat.accounts.disconnect.failed', "Couldn't disconnect."), 'error')
    }
  }

  const askRemove = async (target: ChatMessagingAccountDto) => {
    try {
      const removed = await confirm({
        title: t('chat.personal.remove.title', 'Remove your WhatsApp from Operis?'),
        text: t(
          'chat.personal.remove.text',
          'It is disconnected and forgotten here. Chats you moved stay with the company.',
        ),
        confirmText: t('chat.accounts.remove.confirm', 'Remove'),
        variant: 'destructive',
        onConfirm: () => remove.mutateAsync(target),
      })
      if (removed) flash(t('chat.personal.remove.done', 'Your WhatsApp was removed.'), 'success')
    } catch (error) {
      flash(error instanceof Error ? error.message : t('chat.accounts.remove.failed', "Couldn't remove it."), 'error')
    }
  }

  const reason =
    account && (account.status === 'failed' || account.status === 'disconnected')
      ? accountReasonText(t, account.statusReason)
      : null

  return (
    <Page>
      <PageHeader
        title={t('chat.personal.title', 'My WhatsApp')}
        description={t(
          'chat.personal.description',
          'Connect your own WhatsApp to bring a customer chat into Operis — so colleagues can help, and the conversation stays with the company.',
        )}
      />
      <PageBody>
        <Alert
          status="information"
          style="lighter"
          icon={<ShieldCheck aria-hidden="true" />}
          data-testid="chat-personal-privacy"
        >
          <AlertTitle>{t('chat.personal.privacyTitle', 'Private unless you move a chat')}</AlertTitle>
          <AlertDescription>
            {t(
              'chat.personal.privacy',
              'Operis never reads your WhatsApp. Only a chat you move to the company comes in, and only what is said after you move it.',
            )}
          </AlertDescription>
        </Alert>

        {list.isLoading ? <LoadingMessage label={t('chat.accounts.loading', 'Loading accounts…')} /> : null}
        {list.error ? <ErrorMessage label={t('chat.accounts.loadFailed', "Couldn't load the accounts.")} /> : null}

        {list.data && !available ? (
          <Alert status="information" style="lighter">
            <AlertTitle>{t('chat.personal.unavailableTitle', "Personal WhatsApp isn't set up on this server")}</AlertTitle>
            <AlertDescription>
              {t('chat.personal.unavailable', 'An administrator has to enable it first.')}
            </AlertDescription>
          </Alert>
        ) : null}

        {list.data && available && !account ? (
          <EmptyState
            icon={<MessageCircle className="size-6" aria-hidden="true" />}
            title={t('chat.personal.emptyTitle', 'Your WhatsApp is not connected')}
            description={t(
              'chat.personal.emptyDescription',
              'Connect it by scanning a code, the way you link WhatsApp Web.',
            )}
            actions={
              <Button type="button" onClick={() => void startConnect()} disabled={create.isPending}>
                {t('chat.personal.connect', 'Connect my WhatsApp')}
              </Button>
            }
          />
        ) : null}

        {account ? (
          <div
            className="flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-sm card-edge sm:flex-row sm:items-center"
            data-testid="chat-personal-account"
            data-account-id={account.id}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold text-foreground">{account.name}</span>
                <StatusBadge variant={accountStatusVariant(account.status)} dot>
                  {accountStatusLabel(t, account.status)}
                </StatusBadge>
              </div>
              <p className="text-sm text-muted-foreground">
                {account.remoteHandle
                  ? `${networkLabel(t, account.network)} · ${account.remoteHandle}`
                  : networkLabel(t, account.network)}
              </p>
              {reason ? <p className="text-sm text-status-warning-text">{reason}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {account.status === 'connected' ? (
                <>
                  <Button type="button" onClick={() => setMoving(true)} data-testid="chat-personal-move">
                    <ArrowRightLeft className="size-4" aria-hidden="true" />
                    {t('chat.personal.move.action', 'Move a chat to the company')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void askDisconnect(account)}>
                    {t('chat.accounts.disconnect.action', 'Disconnect')}
                  </Button>
                </>
              ) : (
                <Button type="button" onClick={() => setConnecting(account)} disabled={!available}>
                  {account.connectedAt
                    ? t('chat.accounts.reconnect', 'Reconnect')
                    : t('chat.accounts.connect.action', 'Connect')}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => void askRemove(account)}>
                {t('chat.accounts.remove.action', 'Remove')}
              </Button>
            </div>
          </div>
        ) : null}
      </PageBody>

      <ConnectAccountDialog open={Boolean(connecting)} onClose={() => setConnecting(null)} account={connecting} />
      <MoveChatDialog open={moving} onClose={() => setMoving(false)} account={account} />
      {ConfirmDialogElement}
    </Page>
  )
}
