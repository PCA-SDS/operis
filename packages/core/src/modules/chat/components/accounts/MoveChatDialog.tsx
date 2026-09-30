"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { MessageCircle, Search, Users } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
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
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Input } from '@open-mercato/ui/primitives/input'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ChatAccountChatDto, ChatMessagingAccountDto } from '../../data/types'
import { useAccountChats, useAccountMutations } from './useAccounts'

/**
 * Pick one chat on your personal WhatsApp and move it to the company.
 *
 * The list is read from WhatsApp as the dialog opens — names only, nothing
 * stored. Moving asks first, because it is the moment a private chat becomes a
 * company conversation; from then on what is said in it comes into Operis,
 * and what was said before stays on the phone. The question is a step of this
 * dialog, not a second modal over it: a modal on a modal is hidden from
 * assistive technology and loses the keyboard to the one beneath.
 */
export function MoveChatDialog({
  open,
  onClose,
  account,
}: {
  open: boolean
  onClose: () => void
  account: ChatMessagingAccountDto | null
}) {
  const t = useT()
  const router = useRouter()
  const chats = useAccountChats(account?.id ?? null, open)
  const { moveChat } = useAccountMutations()
  const [filter, setFilter] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<ChatAccountChatDto | null>(null)

  React.useEffect(() => {
    if (!open) return
    setFilter('')
    setError(null)
    setPending(null)
  }, [open])

  const needle = filter.trim().toLowerCase()
  const visible = (chats.data ?? []).filter((chat) => needle.length === 0 || chat.name.toLowerCase().includes(needle))

  const openConversation = (conversationId: string) => {
    onClose()
    router.push(`/backend/chat/${conversationId}`)
  }

  const choose = (chat: ChatAccountChatDto) => {
    if (chat.conversationId) {
      openConversation(chat.conversationId)
      return
    }
    setError(null)
    setPending(chat)
  }

  const move = async () => {
    if (!account || !pending || moveChat.isPending) return
    setError(null)
    try {
      const moved = await moveChat.mutateAsync({ account, chatId: pending.id })
      flash(t('chat.personal.move.done', 'Moved. New messages in it now arrive here.'), 'success')
      openConversation(moved.conversationId)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('chat.personal.move.failed', "Couldn't move that chat."))
    }
  }

  const picker = (
    <>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={filter}
          autoFocus
          onChange={(event) => setFilter(event.target.value)}
          aria-label={t('chat.personal.move.searchLabel', 'Find a chat')}
          placeholder={t('chat.personal.move.searchPlaceholder', 'Name…')}
          className="pl-9"
        />
      </div>
      {chats.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : chats.error ? (
        <ErrorMessage
          label={t('chat.personal.move.loadFailed', "Couldn't read your chats from WhatsApp.")}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void chats.refetch()}>
              {t('chat.actions.retry', 'Try again')}
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          variant="subtle"
          size="sm"
          icon={<MessageCircle className="size-5" aria-hidden="true" />}
          title={
            needle
              ? t('chat.personal.move.noMatch', 'No chat matches that')
              : t('chat.personal.move.none', 'No chats on this WhatsApp yet')
          }
        />
      ) : (
        <ul className="flex flex-col gap-1" data-testid="chat-personal-chats">
          {visible.map((chat) => (
            <li key={chat.id}>
              <button
                type="button"
                disabled={moveChat.isPending}
                onClick={() => choose(chat)}
                className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left outline-none transition-colors hover:bg-surface-muted focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="chat-personal-chat"
              >
                <Avatar
                  label={chat.name}
                  size="md"
                  icon={chat.kind === 'group' ? <Users className="size-4" aria-hidden="true" /> : undefined}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{chat.name}</span>
                {chat.conversationId ? <Tag variant="info">{t('chat.personal.move.moved', 'In Operis')}</Tag> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        size="default"
        className="flex flex-col overflow-hidden"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && pending) {
            event.preventDefault()
            void move()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {pending
              ? t('chat.personal.move.confirmTitle', 'Move “{name}” to the company?', { name: pending.name })
              : t('chat.personal.move.title', 'Move a chat to the company')}
          </DialogTitle>
          <DialogDescription>
            {pending
              ? t(
                  'chat.personal.move.confirmText',
                  'From now on, what is said in this chat comes into Operis, where you can bring in colleagues. Earlier messages stay on your phone only.',
                )
              : t(
                  'chat.personal.move.description',
                  'Your chats on WhatsApp, read just now. Only the one you move comes into Operis — the rest stay private.',
                )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {error ? <ErrorMessage label={error} /> : null}
          {pending ? null : picker}
        </DialogBody>
        <DialogFooter bordered>
          {pending ? (
            <>
              <Button type="button" variant="soft" onClick={() => setPending(null)} disabled={moveChat.isPending}>
                {t('chat.personal.move.back', 'Back')}
              </Button>
              <Button
                type="button"
                onClick={() => void move()}
                disabled={moveChat.isPending}
                data-testid="chat-personal-move-confirm"
              >
                {moveChat.isPending
                  ? t('chat.personal.move.moving', 'Moving…')
                  : t('chat.personal.move.confirm', 'Move to the company')}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={onClose}>
              {t('chat.actions.close', 'Close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
