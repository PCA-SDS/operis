"use client"

import * as React from 'react'
import { MessageCircle, Plus } from 'lucide-react'
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
import { AccountFormDialog } from './AccountFormDialog'
import { ConnectAccountDialog } from './ConnectAccountDialog'
import { accountReasonText, accountStatusLabel, accountStatusVariant } from './accountText'
import { useAccountList, useAccountMutations } from './useAccounts'

const PRIMARY_NETWORK = 'whatsapp'

/**
 * `/backend/chat/accounts` — the company's WhatsApp numbers.
 *
 * Add a number, pick its team, connect it by scanning a code; every chat on it
 * then arrives in Chat for that team. Disconnecting stops new chats and
 * replies; the conversations stay.
 */
export function AccountsManager() {
  const t = useT()
  const list = useAccountList()
  const { disconnect, remove } = useAccountMutations()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ChatMessagingAccountDto | null>(null)
  const [connecting, setConnecting] = React.useState<ChatMessagingAccountDto | null>(null)

  const available = list.data?.networks.includes(PRIMARY_NETWORK) ?? false
  const canManage = list.data?.canManageCompany ?? false
  const accounts = (list.data?.items ?? []).filter((account) => account.ownerType === 'company')

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const askDisconnect = async (account: ChatMessagingAccountDto) => {
    try {
      await confirm({
        title: t('chat.accounts.disconnect.title', 'Disconnect {name}?', { name: account.name }),
        text: t(
          'chat.accounts.disconnect.text',
          'WhatsApp removes Operis from Linked devices. Existing chats stay, but nothing new arrives and nobody can reply until you connect it again.',
        ),
        confirmText: t('chat.accounts.disconnect.confirm', 'Disconnect'),
        variant: 'destructive',
        onConfirm: () => disconnect.mutateAsync(account),
      })
    } catch (error) {
      flash(error instanceof Error ? error.message : t('chat.accounts.disconnect.failed', "Couldn't disconnect."), 'error')
    }
  }

  const askRemove = async (account: ChatMessagingAccountDto) => {
    try {
      const removed = await confirm({
        title: t('chat.accounts.remove.title', 'Remove {name}?', { name: account.name }),
        text: t(
          'chat.accounts.remove.text',
          'It is disconnected from WhatsApp and removed from this list. Its chats stay in Chat.',
        ),
        confirmText: t('chat.accounts.remove.confirm', 'Remove'),
        variant: 'destructive',
        onConfirm: () => remove.mutateAsync(account),
      })
      if (removed) flash(t('chat.accounts.remove.done', 'Account removed.'), 'success')
    } catch (error) {
      flash(error instanceof Error ? error.message : t('chat.accounts.remove.failed', "Couldn't remove it."), 'error')
    }
  }

  return (
    <Page>
      <PageHeader
        title={t('chat.accounts.title', 'WhatsApp')}
        description={t(
          'chat.accounts.description',
          "Connect your company's WhatsApp numbers. Every chat on a connected number arrives in Chat for the team you choose, and replies go out from that number.",
        )}
        actions={
          available && canManage ? (
            <Button type="button" onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" />
              {t('chat.accounts.add', 'Add account')}
            </Button>
          ) : null
        }
      />
      <PageBody>
        {list.isLoading ? <LoadingMessage label={t('chat.accounts.loading', 'Loading accounts…')} /> : null}
        {list.error ? <ErrorMessage label={t('chat.accounts.loadFailed', "Couldn't load the accounts.")} /> : null}

        {list.data && !available ? (
          <Alert status="information" style="lighter">
            <AlertTitle>{t('chat.accounts.unavailableTitle', "WhatsApp isn't set up on this server")}</AlertTitle>
            <AlertDescription>
              {t(
                'chat.accounts.unavailable',
                'An administrator has to enable the WhatsApp bridge first. Existing chats stay readable.',
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        {list.data && accounts.length === 0 && available ? (
          <EmptyState
            icon={<MessageCircle className="size-6" aria-hidden="true" />}
            title={t('chat.accounts.emptyTitle', 'No WhatsApp numbers yet')}
            description={t(
              'chat.accounts.emptyDescription',
              'Add the number your customers write to, choose who answers, and scan a code to connect it.',
            )}
            actions={
              canManage ? (
                <Button type="button" onClick={openCreate}>
                  <Plus className="size-4" aria-hidden="true" />
                  {t('chat.accounts.add', 'Add account')}
                </Button>
              ) : null
            }
          />
        ) : null}

        {accounts.length > 0 ? (
          <ul className="flex flex-col gap-3" data-testid="chat-accounts-list">
            {accounts.map((account) => {
              const reason =
                account.status === 'failed' || account.status === 'disconnected'
                  ? accountReasonText(t, account.statusReason)
                  : null
              return (
                <li
                  key={account.id}
                  className="flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-sm card-edge sm:flex-row sm:items-center"
                  data-testid="chat-account"
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
                    <p className="text-sm text-muted-foreground">
                      {account.members.length > 0
                        ? t('chat.accounts.team', 'Team: {names}', {
                            names: account.members.map((member) => member.name).join(', '),
                          })
                        : t('chat.accounts.noTeam', 'No team — new chats go to whoever connected it.')}
                    </p>
                    {reason ? <p className="text-sm text-status-warning-text">{reason}</p> : null}
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      {account.status === 'connected' ? (
                        <Button type="button" variant="outline" onClick={() => void askDisconnect(account)}>
                          {t('chat.accounts.disconnect.action', 'Disconnect')}
                        </Button>
                      ) : (
                        <Button type="button" onClick={() => setConnecting(account)} disabled={!available}>
                          {account.connectedAt
                            ? t('chat.accounts.reconnect', 'Reconnect')
                            : t('chat.accounts.connect.action', 'Connect')}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditing(account)
                          setFormOpen(true)
                        }}
                      >
                        {t('chat.accounts.edit', 'Edit')}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => void askRemove(account)}>
                        {t('chat.accounts.remove.action', 'Remove')}
                      </Button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </PageBody>

      <AccountFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        network={PRIMARY_NETWORK}
        account={editing}
        onCreated={(created) => setConnecting(created)}
      />
      <ConnectAccountDialog open={Boolean(connecting)} onClose={() => setConnecting(null)} account={connecting} />
      {ConfirmDialogElement}
    </Page>
  )
}
