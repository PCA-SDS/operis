"use client"

import * as React from 'react'
import { PinOff } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatListTimestamp } from './format'
import { useMessageEngagement, usePinnedMessages } from './hooks'

export type PinnedMessagesListProps = {
  conversationId: string
  /** Whether the region is showing this list; gates the fetch. */
  active: boolean
  /** Owners in a space, either participant in a direct — matches the server rule. */
  canUnpin: boolean
  onJumpToMessage: (messageId: string) => void
}

/**
 * Everything pinned in this conversation.
 *
 * Deliberately a list of pointers rather than a second transcript: each row
 * carries who wrote it, when, and enough of the text to recognise, and clicking
 * takes you to the message itself. Rendering the full bodies here would make
 * this a place to read rather than a place to find — and beside the transcript
 * the real thing is already one click away.
 */
export function PinnedMessagesList({
  conversationId,
  active,
  canUnpin,
  onJumpToMessage,
}: PinnedMessagesListProps) {
  const t = useT()
  const locale = useLocale()
  const { pinned, isLoading, error, retry } = usePinnedMessages(conversationId, active)
  const { setPinned } = useMessageEngagement(conversationId)

  /**
   * Which row is being unpinned.
   *
   * The mutation exposes one pending flag for the whole conversation, so
   * keying the disabled state off it froze every row while any one of them was
   * being unpinned — on a long list that reads as the panel having stopped
   * working. Only the row that was asked to do something should look busy.
   */
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!setPinned.isPending) setPendingId(null)
  }, [setPinned.isPending])

  if (isLoading) {
    return (
      <div aria-busy="true" className="space-y-2">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-start gap-3 px-3 py-2.5">
            <Skeleton shape="circle" className="size-7" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <ErrorMessage
        label={t('chat.pins.error', "Couldn't load the pinned messages")}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => retry()}>
            {t('chat.actions.retry', 'Try again')}
          </Button>
        }
      />
    )
  }

  if (pinned.length === 0) {
    return (
      <EmptyState
        variant="subtle"
        size="sm"
        title={t('chat.pins.emptyTitle', 'No pinned messages yet')}
        description={t('chat.pins.emptyDescription', 'Pin a message to keep it easy to find here.')}
      />
    )
  }

  return (
    <ul className="flex flex-col gap-1">
      {pinned.map((entry) => (
        <li key={entry.messageId} className="flex items-start gap-1">
          {/* The row is the navigation. A pinned entry that only closed the
              panel would be the dead end this panel exists to avoid. */}
          <button
            type="button"
            onClick={() => onJumpToMessage(entry.messageId)}
            className="flex min-w-0 flex-1 items-start gap-3 rounded-lg px-2 py-2.5 text-left outline-none transition-colors hover:bg-surface-muted focus-visible:shadow-focus"
          >
            <Avatar label={entry.senderName} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                  {entry.senderName}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatListTimestamp(locale, new Date(entry.createdAt))}
                </span>
              </span>
              {/* Two lines rather than one truncated one: the panel is narrower
                  than the dialog was, and a single clipped line of a 160-char
                  preview is rarely enough to recognise a message by. */}
              <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                {entry.preview}
              </span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {entry.isReply
                  ? t('chat.pins.pinnedReplyBy', 'Reply · pinned by {name}', {
                      name: entry.pinnedByName,
                    })
                  : t('chat.pins.pinnedBy', 'Pinned by {name}', { name: entry.pinnedByName })}
              </span>
            </span>
          </button>

          {/* Hidden rather than disabled for someone who cannot unpin — a greyed
              control on every row answers a question nobody asked. */}
          {canUnpin ? (
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              // `mt-2.5` mirrors the sibling button's `py-2.5` exactly, so the
              // control's centre lands on the avatar's rather than on the middle
              // of a three-line row.
              className="mt-2.5 shrink-0"
              disabled={pendingId === entry.messageId}
              aria-label={t('chat.pins.unpin', 'Unpin message')}
              onClick={() => {
                setPendingId(entry.messageId)
                setPinned.mutate({ messageId: entry.messageId, pinned: false })
              }}
            >
              <PinOff className="size-4" aria-hidden="true" />
            </IconButton>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
