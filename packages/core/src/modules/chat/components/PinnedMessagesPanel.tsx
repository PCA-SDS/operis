"use client"

import * as React from 'react'
import { PinOff } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatListTimestamp } from './format'
import { useMessageEngagement, usePinnedMessages } from './hooks'

export type PinnedMessagesPanelProps = {
  open: boolean
  onClose: () => void
  conversationId: string
  /** Owners in a space, either participant in a direct — matches the server rule. */
  canUnpin: boolean
  /** Take the reader to the original. Closing the panel is part of the job. */
  onJumpToMessage: (messageId: string) => void
}

/**
 * Everything pinned in this conversation.
 *
 * Deliberately a list of pointers rather than a second transcript: each row
 * carries who wrote it, when, and enough of the text to recognise, and clicking
 * takes you to the message itself. Rendering the full bodies here would make the
 * panel a place to read rather than a place to find.
 */
export function PinnedMessagesPanel({
  open,
  onClose,
  conversationId,
  canUnpin,
  onJumpToMessage,
}: PinnedMessagesPanelProps) {
  const t = useT()
  const locale = useLocale()
  const { pinned, total, isLoading, error, retry } = usePinnedMessages(conversationId, open)
  const { setPinned } = useMessageEngagement(conversationId)

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="default" className="flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('chat.pins.title', 'Pinned messages')}</DialogTitle>
          <DialogDescription>
            {t(
              `chat.pins.count${total === 1 ? '' : '_plural'}`,
              '{count} pinned messages in this conversation',
              { count: total },
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {isLoading ? (
            <div aria-busy="true" className="space-y-2">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-start gap-3 px-2 py-2">
                  <Skeleton shape="circle" className="size-8" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <ErrorMessage
              label={t('chat.pins.error', "Couldn't load the pinned messages")}
              action={
                <Button type="button" variant="outline" size="sm" onClick={() => retry()}>
                  {t('chat.actions.retry', 'Try again')}
                </Button>
              }
            />
          ) : pinned.length === 0 ? (
            // Reachable only from a header control that hides itself at zero, so
            // this is the race where the last pin was removed while the panel was
            // open rather than a dead end someone navigated into.
            <EmptyState
              variant="subtle"
              size="sm"
              title={t('chat.pins.emptyTitle', 'No pinned messages yet')}
              description={t(
                'chat.pins.emptyDescription',
                'Pin a message to keep it easy to find here.',
              )}
            />
          ) : (
            <ul className="flex flex-col gap-1">
              {pinned.map((entry) => (
                <li key={entry.messageId} className="flex items-start gap-2">
                  {/* The row is the navigation. A pinned entry that only closed
                      the panel would be the dead end this panel exists to avoid. */}
                  <button
                    type="button"
                    onClick={() => {
                      onJumpToMessage(entry.messageId)
                      onClose()
                    }}
                    className="flex min-w-0 flex-1 items-start gap-3 rounded-lg px-3 py-2.5 text-left outline-none transition-colors hover:bg-surface-muted focus-visible:shadow-focus"
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
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
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

                  {/* Hidden rather than disabled for someone who cannot unpin —
                      a greyed control on every row answers a question nobody
                      asked. */}
                  {canUnpin ? (
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      // `mt-2.5` mirrors the sibling button's `py-2.5` exactly.
                      // The row is three lines tall, so this control belongs on
                      // the FIRST of them; matching the neighbour's top padding
                      // is what puts its centre on the avatar's, and a hand-picked
                      // `mt-2` left the two 2px apart.
                      className="mt-2.5 shrink-0"
                      disabled={setPinned.isPending}
                      aria-label={t('chat.pins.unpin', 'Unpin message')}
                      onClick={() =>
                        setPinned.mutate({ messageId: entry.messageId, pinned: false })
                      }
                    >
                      <PinOff className="size-4" aria-hidden="true" />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
