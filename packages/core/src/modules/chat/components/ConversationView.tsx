"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ChatMessageDto } from '../data/types'
import { MessageComposer } from './MessageComposer'
import { MessageList, type PendingMessage } from './MessageList'
import { useCanSendChat, useConversation, useMarkRead, useMessages, useSendMessage } from './hooks'

export type ConversationViewProps = {
  conversationId: string
  currentUserId: string
  /** Rendered on narrow viewports, where the list and the conversation are separate screens. */
  showBackToList?: boolean
}

const logger = createLogger('chat').child({ component: 'ConversationView' })

function newClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * The right pane: who you are talking to, the transcript, and the composer.
 *
 * Sending is optimistic *in the transcript only*: the bubble appears greyed
 * immediately so typing feels instant, but it is never treated as stored. When
 * the server confirms, the real message replaces it; when the request fails, the
 * bubble turns into a "Not sent — try again" affordance rather than vanishing.
 * The retry reuses the same `clientMessageId`, so a request that actually
 * committed before the connection dropped is deduplicated server-side instead of
 * posting twice.
 */
export function ConversationView({ conversationId, currentUserId, showBackToList }: ConversationViewProps) {
  const t = useT()
  const { conversation, isLoading: isLoadingConversation, error: conversationError, retry } =
    useConversation(conversationId)
  const {
    messages,
    isLoading: isLoadingMessages,
    error: messagesError,
    hasOlder,
    isLoadingOlder,
    loadOlder,
    retry: retryMessages,
  } = useMessages(conversationId)
  const sendMessage = useSendMessage(conversationId)
  const canSend = useCanSendChat()

  const [pending, setPending] = React.useState<PendingMessage[]>([])

  // A conversation switch must not carry the previous one's unsent drafts.
  React.useEffect(() => {
    setPending([])
  }, [conversationId])

  const confirmedIds = React.useMemo(
    () => new Set(messages.map((message) => message.clientMessageId).filter(Boolean) as string[]),
    [messages],
  )

  // Once the server's copy of a message arrives, its optimistic twin has done
  // its job. Dropping it here rather than on the mutation's success covers the
  // case where the SSE refetch lands first.
  React.useEffect(() => {
    if (confirmedIds.size === 0) return
    setPending((current) => {
      const next = current.filter((item) => !confirmedIds.has(item.clientMessageId))
      return next.length === current.length ? current : next
    })
  }, [confirmedIds])

  const newestMessage = messages[messages.length - 1] as ChatMessageDto | undefined
  useMarkRead(conversationId, newestMessage, currentUserId)

  const deliver = React.useCallback(
    async (clientMessageId: string, body: string) => {
      try {
        await sendMessage.mutateAsync({ body, clientMessageId })
        setPending((current) => current.filter((item) => item.clientMessageId !== clientMessageId))
      } catch (error) {
        setPending((current) =>
          current.map((item) =>
            item.clientMessageId === clientMessageId ? { ...item, failed: true } : item,
          ),
        )
        throw error
      }
    },
    [sendMessage],
  )

  const handleSend = React.useCallback(
    (body: string) => {
      const clientMessageId = newClientMessageId()
      setPending((current) => [
        ...current,
        { clientMessageId, body, createdAt: new Date().toISOString(), failed: false },
      ])
      // The bubble owns the message from here: a rejection flips it to `failed`
      // and the retry there reuses this same `clientMessageId`. The rejection is
      // already represented in the UI, so it is logged rather than re-thrown.
      void deliver(clientMessageId, body).catch((err: unknown) => {
        logger.warn('Sending a chat message failed', { conversationId, clientMessageId, err })
      })
    },
    [conversationId, deliver],
  )

  const handleRetryPending = React.useCallback(
    (clientMessageId: string) => {
      const target = pending.find((item) => item.clientMessageId === clientMessageId)
      if (!target) return
      setPending((current) =>
        current.map((item) => (item.clientMessageId === clientMessageId ? { ...item, failed: false } : item)),
      )
      // Same key as the first attempt, so a send that committed before the
      // connection dropped is deduplicated rather than posted twice.
      void deliver(clientMessageId, target.body).catch((err: unknown) => {
        logger.warn('Retrying a chat message failed', { conversationId, clientMessageId, err })
      })
    },
    [conversationId, deliver, pending],
  )

  const counterpartName = conversation?.counterpart?.name ?? t('chat.list.unknownPerson', 'Former colleague')
  const counterpartLeft = Boolean(conversation) && conversation?.counterpart == null

  /**
   * The header renders in every state, including loading and error.
   *
   * It carries the only way back to the list on narrow screens, where the list
   * pane is hidden. Returning early before it — which this component used to do
   * — left a phone user on a broken conversation with no back button, no list,
   * and a "Try again" that for a 404 can never succeed.
   */
  const header = (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      {showBackToList ? (
        <IconButton variant="ghost" size="sm" asChild className="lg:hidden">
          <Link href="/backend/chat" aria-label={t('chat.conversation.back', 'Back to conversations')}>
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
        </IconButton>
      ) : null}
      <Avatar label={conversation ? counterpartName : ''} size="md" />
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-foreground">
          {conversation ? counterpartName : t('chat.conversation.loading', 'Loading conversation…')}
        </h2>
        {conversation?.counterpart ? (
          <p className="truncate text-xs text-muted-foreground">{conversation.counterpart.email}</p>
        ) : conversation ? (
          <p className="truncate text-xs text-muted-foreground">
            {t('chat.conversation.counterpartLeft', 'No longer in this organization')}
          </p>
        ) : null}
      </div>
    </header>
  )

  if (isLoadingConversation) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <LoadingMessage label={t('chat.conversation.loading', 'Loading conversation…')} />
        </div>
      </div>
    )
  }

  if (conversationError || !conversation) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <ErrorMessage
            label={t('chat.conversation.error', "Couldn't open this conversation")}
            description={t(
              'chat.conversation.errorDescription',
              'It may have been removed, or it may not be yours to read.',
            )}
            action={
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => retry()}>
                  {t('chat.actions.retry', 'Try again')}
                </Button>
                {/* Always offer a way out, not only a retry that a 404 will
                    never satisfy. */}
                <Button type="button" size="sm" asChild>
                  <Link href="/backend/chat">{t('chat.start.backToChat', 'Go to chat')}</Link>
                </Button>
              </div>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}

      {messagesError && messages.length === 0 ? (
        <div className="p-4">
          <ErrorMessage
            label={t('chat.messages.error', "Couldn't load messages")}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => retryMessages()}>
                {t('chat.actions.retry', 'Try again')}
              </Button>
            }
          />
        </div>
      ) : (
        <MessageList
          messages={messages}
          pending={pending}
          currentUserId={currentUserId}
          counterpartName={counterpartName}
          isLoading={isLoadingMessages}
          hasOlder={hasOlder}
          isLoadingOlder={isLoadingOlder}
          loadOlderFailed={Boolean(messagesError)}
          onLoadOlder={() => void loadOlder()}
          onRetryPending={handleRetryPending}
        />
      )}

      <MessageComposer
        disabled={counterpartLeft || !canSend}
        onSend={handleSend}
        placeholder={
          !canSend
            ? t('chat.composer.readOnly', 'You do not have permission to send messages')
            : counterpartLeft
              ? t('chat.composer.disabled', 'This person has left the organization')
              : t('chat.composer.placeholder', 'Message {name}', { name: counterpartName })
        }
      />
    </div>
  )
}
