"use client"

import * as React from 'react'
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
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ChatDirectoryEntryDto, ChatMessagingAccountDto } from '../../data/types'
import { MAX_ACCOUNT_NAME_LENGTH } from '../../data/validators'
import { MemberPicker } from '../MemberPicker'
import { useAccountMutations } from './useAccounts'

const MAX_TEAM = 100

export type AccountFormDialogProps = {
  open: boolean
  onClose: () => void
  /** The network a new account is on. */
  network: string
  /** Present to edit; absent to add. */
  account?: ChatMessagingAccountDto | null
  onCreated?: (account: ChatMessagingAccountDto) => void
}

function asDirectoryEntries(members: ChatMessagingAccountDto['members']): ChatDirectoryEntryDto[] {
  return members.map((member) => ({ id: member.id, name: member.name, email: '', roleNames: [] }))
}

/**
 * Name a company WhatsApp account and pick who answers its chats.
 *
 * The team is required: every chat that arrives on the number is seated with
 * these colleagues, and a chat nobody inside can read would be a customer
 * talking to no one. Changing it later affects chats that arrive afterwards.
 */
export function AccountFormDialog({ open, onClose, network, account, onCreated }: AccountFormDialogProps) {
  const t = useT()
  const editing = Boolean(account)
  const [name, setName] = React.useState('')
  const [team, setTeam] = React.useState<ChatDirectoryEntryDto[]>([])
  const [signReplies, setSignReplies] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const { create, update } = useAccountMutations()
  const pending = create.isPending || update.isPending

  React.useEffect(() => {
    if (!open) return
    setName(account?.name ?? '')
    setTeam(account ? asDirectoryEntries(account.members) : [])
    setSignReplies(account?.showSenderName ?? false)
    setError(null)
  }, [open, account])

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && team.length > 0 && !pending

  const submit = React.useCallback(async () => {
    if (!canSubmit) return
    setError(null)
    try {
      if (account) {
        await update.mutateAsync({
          account,
          changes: { name: trimmed, memberUserIds: team.map((person) => person.id), showSenderName: signReplies },
        })
      } else {
        const created = await create.mutateAsync({
          network,
          name: trimmed,
          ownerType: 'company',
          memberUserIds: team.map((person) => person.id),
        })
        if (signReplies) {
          await update.mutateAsync({ account: created, changes: { showSenderName: true } })
        }
        onCreated?.(created)
      }
      onClose()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : t('chat.accounts.form.saveFailed', "Couldn't save the account."),
      )
    }
  }, [account, canSubmit, create, network, onClose, onCreated, signReplies, t, team, trimmed, update])

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        size="default"
        className="flex flex-col overflow-hidden"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t('chat.accounts.form.editTitle', 'Edit WhatsApp account')
              : t('chat.accounts.form.createTitle', 'Add a WhatsApp account')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'chat.accounts.form.description',
              'Chats on this number go to the colleagues you pick here. You connect the number in the next step.',
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          <FormField label={t('chat.accounts.form.nameLabel', 'Name')} required>
            <Input
              value={name}
              autoFocus
              maxLength={MAX_ACCOUNT_NAME_LENGTH}
              disabled={pending}
              placeholder={t('chat.accounts.form.namePlaceholder', 'Sales WhatsApp')}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>

          <SwitchField
            label={t('chat.accounts.form.signLabel', "Sign replies with the colleague's first name")}
            description={t(
              'chat.accounts.form.signDescription',
              'Customers see "Jules: …" instead of an unsigned message from the company.',
            )}
            checked={signReplies}
            disabled={pending}
            onCheckedChange={setSignReplies}
          />

          {error ? <ErrorMessage label={error} /> : null}

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
            <p className="text-sm font-medium text-foreground">{t('chat.accounts.form.teamLabel', 'Team')}</p>
            <p className="text-sm text-muted-foreground">
              {t('chat.accounts.form.teamHint', 'Everyone here is added to each new chat and can answer it.')}
            </p>
            <MemberPicker
              selected={team}
              onChange={setTeam}
              enabled={open}
              disabled={pending}
              max={MAX_TEAM}
              includeSelf
            />
          </div>
        </DialogBody>

        <DialogFooter bordered>
          <Button type="button" variant="soft" onClick={onClose} disabled={pending}>
            {t('chat.actions.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit}>
            {pending
              ? t('chat.accounts.form.saving', 'Saving…')
              : editing
                ? t('chat.accounts.form.save', 'Save')
                : t('chat.accounts.form.create', 'Add account')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
