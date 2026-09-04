"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, ChevronRight, Users } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ChatMessageDto } from '../data/types'
import { MessageComposer } from './MessageComposer'
import { MessageList, type PendingMessage } from './MessageList'
import { SpaceDetailsDialog } from './SpaceDetailsDialog'
import { useCanSendChat, useConversation, useMarkRead, useMessages, useSendMessage } from './hooks'

/** What the composer is replying to, as the view holds it. */
export type ReplyTarget = {
  messageId: string
  authorName: string
  body: string
}

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
  const [replyTarget, setReplyTarget] = React.useState<ReplyTarget | null>(null)
  const [detailsOpen, setDetailsOpen] = React.useState(false)

  /**
   * A conversation switch must not carry the previous one's unsent drafts — or
   * its reply target, which would otherwise attach this conversation's next
   * message to a message in the last one. The server would refuse that (the
   * reply must be in the same conversation), so the failure would be a confusing
   * 404 on send rather than a silent cross-post; clearing it here means it never
   * gets that far. The details panel closes for the same reason: it describes a
   * space that is no longer on screen.
   */
  React.useEffect(() => {
    setPending([])
    setReplyTarget(null)
    setDetailsOpen(false)
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

  /**
   * Where the "New" divider goes, frozen at the moment this conversation opened.
   *
   * `useMarkRead` advances the cursor a beat after the transcript paints, so
   * reading `conversation.lastReadAt` live would move the divider to the bottom
   * and then delete it — the reader would never see the thing it exists to show.
   * Captured once per conversation instead, and `undefined` until the first load
   * resolves so an unopened conversation does not mark everything new.
   */
  const unreadSinceRef = React.useRef<{ id: string; value: string | null } | null>(null)
  if (conversation && unreadSinceRef.current?.id !== conversationId) {
    unreadSinceRef.current = { id: conversationId, value: conversation.lastReadAt }
  }
  // `undefined` while the conversation is still loading, so the transcript does
  // not briefly mark every message new before the cursor is known.
  const unreadSince =
    unreadSinceRef.current?.id === conversationId ? unreadSinceRef.current.value : undefined

  const deliver = React.useCallback(
    async (clientMessageId: string, body: string, replyToMessageId?: string) => {
      try {
        await sendMessage.mutateAsync({ body, clientMessageId, replyToMessageId })
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
      // Captured before the state is cleared, so the retry below still knows
      // what this message was replying to even though the composer has moved on.
      const replyToMessageId = replyTarget?.messageId
      setPending((current) => [
        ...current,
        {
          clientMessageId,
          body,
          createdAt: new Date().toISOString(),
          failed: false,
          replyToMessageId,
          replyToAuthorName: replyTarget?.authorName,
          replyToBody: replyTarget?.body,
        },
      ])
      // Cleared on send rather than on success. The reply is already committed to
      // the pending bubble, and leaving the strip up would invite a second reply
      // to the same message while the first is still in flight.
      setReplyTarget(null)
      // The bubble owns the message from here: a rejection flips it to `failed`
      // and the retry there reuses this same `clientMessageId`. The rejection is
      // already represented in the UI, so it is logged rather than re-thrown.
      void deliver(clientMessageId, body, replyToMessageId).catch((err: unknown) => {
        logger.warn('Sending a chat message failed', { conversationId, clientMessageId, err })
      })
    },
    [conversationId, deliver, replyTarget],
  )

  const handleRetryPending = React.useCallback(
    (clientMessageId: string) => {
      const target = pending.find((item) => item.clientMessageId === clientMessageId)
      if (!target) return
      setPending((current) =>
        current.map((item) => (item.clientMessageId === clientMessageId ? { ...item, failed: false } : item)),
      )
      // Same key AND the same reply target as the first attempt, so a send that
      // committed before the connection dropped is deduplicated rather than
      // posted twice — and a retry never loses the reply it was.
      void deliver(clientMessageId, target.body, target.replyToMessageId).catch((err: unknown) => {
        logger.warn('Retrying a chat message failed', { conversationId, clientMessageId, err })
      })
    },
    [conversationId, deliver, pending],
  )

  const isSpace = conversation?.kind === 'space'
  // Resolved server-side for both kinds — a space's name, or the other person's.
  const conversationTitle = conversation?.title ?? t('chat.list.unknownPerson', 'Former colleague')
  // Only a DIRECT conversation can become one-way. A space with a departed
  // member is still a live room for everyone else, so it must not disable the
  // composer for them.
  const counterpartLeft =
    Boolean(conversation) && !isSpace && conversation?.counterpart == null

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

      {/* One header for both kinds. A space differs only in its glyph, its
          subtitle and the fact that the whole block is a button — so the two do
          not drift into separate layouts that have to be kept in step. */}
      {(() => {
        const identity = (
          <>
            <Avatar
              label={conversation ? conversationTitle : ''}
              size="sm"
              icon={isSpace ? <Users className="size-4" aria-hidden="true" /> : undefined}
            />
            <span className="min-w-0 text-left">
              <span className="block truncate text-sm font-semibold text-foreground">
                {conversation ? conversationTitle : t('chat.conversation.loading', 'Loading conversation…')}
              </span>
              {isSpace && conversation ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {t(
                    `chat.space.memberCount${conversation.memberCount === 1 ? '' : '_plural'}`,
                    '{count} members',
                    { count: conversation.memberCount },
                  )}
                </span>
              ) : conversation?.counterpart ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {conversation.counterpart.email}
                </span>
              ) : conversation ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {t('chat.conversation.counterpartLeft', 'No longer in this organization')}
                </span>
              ) : null}
            </span>
          </>
        )

        // The header IS the way into the details panel, the way it is in every
        // client people already use — rather than a separate button competing
        // for the same 56px. A direct has no details, so it stays plain text
        // instead of becoming a control that opens nothing.
        return isSpace ? (
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            aria-haspopup="dialog"
            className="-mx-2 flex min-w-0 items-center gap-2 rounded-md px-2 py-1 outline-none transition-colors hover:bg-surface-muted focus-visible:shadow-focus"
          >
            {identity}
            {/* The header is the way into the details panel, so it needs to look
                like a way in. Without this it was an unmarked click target that
                only revealed itself on hover — discoverable by accident. */}
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="sr-only">{t('chat.space.details', 'Space details')}</span>
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">{identity}</div>
        )
      })()}
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
          conversationTitle={conversationTitle}
          isSpace={Boolean(isSpace)}
          onReply={canSend ? setReplyTarget : undefined}
          isLoading={isLoadingMessages}
          hasOlder={hasOlder}
          isLoadingOlder={isLoadingOlder}
          loadOlderFailed={Boolean(messagesError)}
          unreadSince={unreadSince}
          counterpartLastReadAt={conversation.counterpartLastReadAt}
          onLoadOlder={() => void loadOlder()}
          onRetryPending={handleRetryPending}
        />
      )}

      <MessageComposer
        disabled={counterpartLeft || !canSend}
        onSend={handleSend}
        replyTarget={replyTarget}
        onCancelReply={() => setReplyTarget(null)}
        placeholder={
          !canSend
            ? t('chat.composer.readOnly', 'You do not have permission to send messages')
            : counterpartLeft
              ? t('chat.composer.disabled', 'This person has left the organization')
              : t('chat.composer.placeholder', 'Message {name}', { name: conversationTitle })
        }
      />

      {/* Mounted only for a space, and only once the conversation has loaded —
          it needs the title, the viewer's role and the member count, and there
          is no meaningful skeleton for a panel nobody has opened yet. Kept
          mounted across open/close after that, so Radix can restore focus to
          the header button. */}
      {isSpace && conversation ? (
        <SpaceDetailsDialog
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          conversation={conversation}
          currentUserId={currentUserId}
        />
      ) : null}
    </div>
  )
}
