"use client"

import * as React from 'react'
import { MessageSquare } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ChatMessageDto } from '../data/types'
import { formatDateSeparator, formatFullTimestamp, formatTimeOfDay, isSameDay } from './format'

export type PendingMessage = {
  clientMessageId: string
  body: string
  createdAt: string
  failed: boolean
}

type MessageListProps = {
  messages: ChatMessageDto[]
  pending: PendingMessage[]
  currentUserId: string
  counterpartName: string
  isLoading: boolean
  hasOlder: boolean
  isLoadingOlder: boolean
  /** A page-fetch failed; the transcript stays, the load-more button says so. */
  loadOlderFailed?: boolean
  onLoadOlder: () => void
  onRetryPending: (clientMessageId: string) => void
}

type Row =
  | { kind: 'separator'; key: string; label: string }
  | { kind: 'message'; key: string; message: ChatMessageDto; mine: boolean; showAuthor: boolean }
  | { kind: 'pending'; key: string; pending: PendingMessage }

function MessageListSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="ml-auto h-10 w-1/2 rounded-xl" />
      <Skeleton className="h-10 w-2/3 rounded-xl" />
      <Skeleton className="ml-auto h-10 w-1/3 rounded-xl" />
    </div>
  )
}

/**
 * The transcript.
 *
 * Message bodies are rendered as text nodes with `whitespace-pre-wrap`, never as
 * HTML — a message is exactly the characters that were typed, so there is no
 * markup path for someone to smuggle anything through.
 *
 * Consecutive messages from the same person are visually grouped: the second and
 * later bubbles drop the author line, which is what keeps a fast back-and-forth
 * readable instead of a wall of repeated names.
 */
export function MessageList({
  messages,
  pending,
  currentUserId,
  counterpartName,
  isLoading,
  hasOlder,
  isLoadingOlder,
  loadOlderFailed,
  onLoadOlder,
  onRetryPending,
}: MessageListProps) {
  const t = useT()
  const locale = useLocale()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const bottomRef = React.useRef<HTMLDivElement>(null)

  const separatorLabels = React.useMemo(
    () => ({ today: t('chat.date.today', 'Today'), yesterday: t('chat.date.yesterday', 'Yesterday') }),
    [t],
  )

  const rows = React.useMemo<Row[]>(() => {
    const result: Row[] = []
    let previous: ChatMessageDto | null = null
    for (const message of messages) {
      const createdAt = new Date(message.createdAt)
      if (!previous || !isSameDay(new Date(previous.createdAt), createdAt)) {
        result.push({
          kind: 'separator',
          key: `sep-${message.id}`,
          label: formatDateSeparator(locale, createdAt, separatorLabels),
        })
      }
      const sameAuthorRun =
        previous !== null &&
        previous.senderUserId === message.senderUserId &&
        isSameDay(new Date(previous.createdAt), createdAt)
      result.push({
        kind: 'message',
        key: message.id,
        message,
        mine: message.senderUserId === currentUserId,
        showAuthor: !sameAuthorRun,
      })
      previous = message
    }
    for (const item of pending) {
      result.push({ kind: 'pending', key: `pending-${item.clientMessageId}`, pending: item })
    }
    return result
  }, [currentUserId, locale, messages, pending, separatorLabels])

  // Follow the conversation as it grows, but only when the reader is already at
  // the bottom — yanking someone back down while they are reading history is
  // worse than letting a new message arrive off-screen.
  //
  // Prepends are the opposite case: loading ~30 older messages inserts them
  // *above* the viewport at an unchanged `scrollTop`, which throws the reader
  // somewhere they were not. Restoring the distance from the bottom keeps the
  // message they were looking at exactly where it was.
  const messageCount = messages.length + pending.length
  const previousCount = React.useRef(messageCount)
  const oldestId = messages[0]?.id ?? null
  const previousOldestId = React.useRef(oldestId)
  const prependAnchor = React.useRef<number | null>(null)

  React.useLayoutEffect(() => {
    const container = scrollRef.current
    if (!container) return
    if (oldestId !== previousOldestId.current && previousOldestId.current !== null) {
      prependAnchor.current = container.scrollHeight - container.scrollTop
    }
    previousOldestId.current = oldestId
  }, [oldestId])

  React.useLayoutEffect(() => {
    const container = scrollRef.current
    if (!container) return

    if (prependAnchor.current !== null) {
      container.scrollTop = container.scrollHeight - prependAnchor.current
      prependAnchor.current = null
      previousCount.current = messageCount
      return
    }

    const grew = messageCount > previousCount.current
    const firstPaint = previousCount.current === 0 && messageCount > 0
    previousCount.current = messageCount
    if (!grew) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    if (firstPaint || distanceFromBottom < 160) {
      bottomRef.current?.scrollIntoView({ block: 'end', behavior: firstPaint ? 'auto' : 'smooth' })
    }
  }, [messageCount])

  if (isLoading) return <MessageListSkeleton />

  return (
    /* `tabIndex` on a scrollable region is WCAG 2.1.1: the transcript holds no
       focusable content, so without it a keyboard-only user can tab past a long
       history without ever being able to scroll it. The role and label are what
       make that tab stop announce itself as something worth entering. */
    <div
      ref={scrollRef}
      role="region"
      tabIndex={0}
      aria-label={t('chat.messages.label', 'Messages')}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-3 outline-none focus-visible:shadow-focus"
    >
      {hasOlder ? (
        <div className="mb-3 flex flex-col items-center gap-1">
          {loadOlderFailed ? (
            <p role="alert" className="text-xs text-status-error-text">
              {t('chat.messages.loadOlderFailed', "Couldn't load earlier messages.")}
            </p>
          ) : null}
          <Button type="button" variant="ghost" size="sm" disabled={isLoadingOlder} onClick={onLoadOlder}>
            {isLoadingOlder
              ? t('chat.messages.loadingOlder', 'Loading…')
              : loadOlderFailed
                ? t('chat.actions.retry', 'Try again')
                : t('chat.messages.loadOlder', 'Load earlier messages')}
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <EmptyState
            variant="subtle"
            size="sm"
            icon={<MessageSquare className="size-5" aria-hidden="true" />}
            title={t('chat.messages.emptyTitle', 'No messages yet')}
            description={t('chat.messages.emptyDescription', 'Say hello to {name}.', {
              name: counterpartName,
            })}
          />
        </div>
      ) : null}

      {/* `aria-live` so an incoming message is announced. Without it the core
          interaction of a chat client is silent for a screen-reader user. */}
      <ol className="flex flex-col gap-1" aria-live="polite" aria-relevant="additions">
        {rows.map((row) => {
          if (row.kind === 'separator') {
            return (
              <li key={row.key} className="my-3 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
                <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
              </li>
            )
          }

          if (row.kind === 'pending') {
            return (
              <li key={row.key} className="flex flex-col items-end">
                <div
                  className={cn(
                    // `w-fit` so a short message hugs its text, `max-w-prose`
                    // so a long one wraps at a readable measure instead of
                    // stretching the full pane. Both are scale tokens — a
                    // percentage cap would be an arbitrary value.
                    'w-fit max-w-prose rounded-xl px-3 py-2 text-sm',
                    row.pending.failed
                      ? 'border border-status-error-border bg-status-error-bg text-status-error-text'
                      : 'bg-primary-soft text-foreground opacity-70',
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{row.pending.body}</p>
                </div>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <time dateTime={row.pending.createdAt}>
                    {formatTimeOfDay(locale, new Date(row.pending.createdAt))}
                  </time>
                  {row.pending.failed ? (
                    <>
                      <span className="text-status-error-text">
                        {t('chat.messages.failed', 'Not sent')}
                      </span>
                      <Button
                        type="button"
                        variant="link"
                        size="2xs"
                        onClick={() => onRetryPending(row.pending.clientMessageId)}
                      >
                        {t('chat.actions.retry', 'Try again')}
                      </Button>
                    </>
                  ) : (
                    t('chat.messages.sending', 'Sending…')
                  )}
                </p>
              </li>
            )
          }

          const createdAt = new Date(row.message.createdAt)
          const author = row.mine ? t('chat.messages.you', 'You') : counterpartName
          return (
            <li
              key={row.key}
              className={cn('flex flex-col', row.mine ? 'items-end' : 'items-start', row.showAuthor && 'mt-2')}
            >
              {row.showAuthor ? (
                <p className="mb-0.5 px-1 text-xs font-medium text-muted-foreground">{author}</p>
              ) : null}
              <div
                className={cn(
                  'w-fit max-w-prose rounded-xl px-3 py-2 text-sm',
                  row.mine ? 'bg-primary text-primary-foreground' : 'bg-surface-muted text-foreground',
                )}
              >
                <p className="whitespace-pre-wrap break-words">{row.message.body}</p>
              </div>
              <time
                dateTime={row.message.createdAt}
                title={formatFullTimestamp(locale, createdAt)}
                className="mt-0.5 px-1 text-xs text-muted-foreground"
              >
                {formatTimeOfDay(locale, createdAt)}
              </time>
            </li>
          )
        })}
      </ol>
      <div ref={bottomRef} />
    </div>
  )
}
