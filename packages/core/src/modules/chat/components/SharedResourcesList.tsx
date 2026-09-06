"use client"

import * as React from 'react'
import { Download, FileText, Link2, MessageSquareText } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { formatFullTimestamp } from './format'
import { formatFileSize } from './ComposerAttachments'
import { attachmentHref, attachmentImageHref } from './MessageAttachments'
import { useSharedResources, type SharedKind } from './hooks'

/**
 * What has been shared in this conversation.
 *
 * One list with three views rather than three places to look. Files, media and
 * links are different shapes of the same question — "where did that go?" — and
 * splitting them across separate surfaces would make the reader guess which one
 * held the thing they half-remember.
 *
 * Every entry leads back to the message it came from. A resource without its
 * conversation is a file in a list; with it, it is something somebody said.
 */

export type SharedResourcesListProps = {
  conversationId: string
  /** Whether the region is showing this list; gates the fetch. */
  active: boolean
  onJumpToMessage: (messageId: string) => void
}

const TABS: { value: SharedKind; labelKey: string; fallback: string }[] = [
  { value: 'files', labelKey: 'chat.shared.files', fallback: 'Files' },
  { value: 'media', labelKey: 'chat.shared.media', fallback: 'Media' },
  { value: 'links', labelKey: 'chat.shared.links', fallback: 'Links' },
]

export function SharedResourcesList({
  conversationId,
  active,
  onJumpToMessage,
}: SharedResourcesListProps) {
  const t = useT()
  const [kind, setKind] = React.useState<SharedKind>('files')

  return (
    <div className="flex flex-col gap-2">
      {/* `SegmentedControl`, not `Tabs`: these three filter one list in one
          area rather than swapping between panels, so the `tabpanel` contract
          `Tabs` ships would be a claim about the markup that is not true. It is
          the same call `CalendarTabs` makes for the same reason, and the
          component the design system names for a mutually-exclusive view
          toggle. `fullWidth` because the region is narrow enough that three
          hugging labels leave the row looking unfinished. */}
      <SegmentedControl
        value={kind}
        onValueChange={(next) => setKind(next as SharedKind)}
        size="sm"
        fullWidth
        aria-label={t('chat.shared.title', 'Shared')}
      >
        {TABS.map((tab) => (
          <SegmentedControlItem key={tab.value} value={tab.value}>
            {t(tab.labelKey, tab.fallback)}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>

      {/* One list, filtered — so only the selected kind is ever fetched. */}
      <SharedList
        conversationId={conversationId}
        kind={kind}
        active={active}
        onJumpToMessage={onJumpToMessage}
      />
    </div>
  )
}

function SharedList({
  conversationId,
  kind,
  active,
  onJumpToMessage,
}: {
  conversationId: string
  kind: SharedKind
  active: boolean
  onJumpToMessage: (messageId: string) => void
}) {
  const t = useT()
  const locale = useLocale()
  const { items, isLoading, error, retry, hasMore, loadMore, isLoadingMore } = useSharedResources(
    conversationId,
    kind,
    active,
  )

  if (error) {
    return (
      <ErrorMessage
        label={t('chat.shared.error', "Couldn't load shared resources")}
        action={
          <Button variant="outline" size="sm" onClick={() => void retry()}>
            {t('chat.actions.retry', 'Try again')}
          </Button>
        }
      />
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <EmptyState
        variant="subtle"
        size="sm"
        icon={<FileText className="size-5" aria-hidden="true" />}
        title={
          kind === 'links'
            ? t('chat.shared.emptyLinks', 'No links shared yet')
            : kind === 'media'
              ? t('chat.shared.emptyMedia', 'No photos or videos shared yet')
              : t('chat.shared.emptyFiles', 'No files shared yet')
        }
        description={t('chat.shared.emptyHint', 'Anything shared here will show up in this list.')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Two columns rather than three: the region is narrower than the dialog
          was, and a third thumbnail per row left each one too small to
          recognise. */}
      <ul className={cn(kind === 'media' ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-2')}>
        {items.map((item) => {
          const key = item.kind === 'link' ? item.id : item.attachmentId
          const openInChat = () => onJumpToMessage(item.messageId)

          if (item.kind === 'media') {
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={openInChat}
                  className="block w-full overflow-hidden rounded-lg outline-none focus-visible:shadow-focus"
                  aria-label={t('chat.shared.viewInChat', 'View {name} in chat', {
                    name: item.fileName,
                  })}
                >
                  <img
                    src={attachmentImageHref(item.attachmentId, 'thumb')}
                    alt={item.fileName}
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                  />
                </button>
              </li>
            )
          }

          return (
            <li
              key={key}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2"
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded bg-surface-muted"
                aria-hidden="true"
              >
                {item.kind === 'link' ? (
                  <Link2 className="size-4 text-muted-foreground" />
                ) : (
                  <FileText className="size-4 text-muted-foreground" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                {item.kind === 'link' ? (
                  <>
                    {/* The URL is shown, not fetched. Nothing here asks a server
                        to visit a link somebody pasted, which is what keeps this
                        from becoming a way to reach the inside of the network. */}
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="block truncate text-sm font-medium text-primary hover:underline"
                      title={item.url}
                    >
                      {item.url}
                    </a>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.host} · {item.sharedByName} ·{' '}
                      {formatFullTimestamp(locale, new Date(item.createdAt))}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="truncate text-sm font-medium text-foreground" title={item.fileName}>
                      {item.fileName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatFileSize(item.fileSize)} · {item.uploaderName} ·{' '}
                      {formatFullTimestamp(locale, new Date(item.createdAt))}
                    </p>
                  </>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {item.kind !== 'link' ? (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={attachmentHref(item.attachmentId)} download={item.fileName}>
                      <Download className="size-3.5" aria-hidden="true" />
                      <span className="sr-only">
                        {t('chat.attachments.download', 'Download {name}', { name: item.fileName })}
                      </span>
                    </a>
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={openInChat}>
                  <MessageSquareText className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">{t('chat.shared.viewInChatShort', 'View in chat')}</span>
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      {hasMore ? (
        <div className="flex justify-center pt-1">
          <Button variant="ghost" size="sm" disabled={isLoadingMore} onClick={() => void loadMore()}>
            {isLoadingMore
              ? t('chat.shared.loadingMore', 'Loading…')
              : t('chat.shared.loadMore', 'Load more')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
