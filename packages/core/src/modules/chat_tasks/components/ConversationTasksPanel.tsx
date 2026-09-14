"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ChatTaskCard } from './ChatTaskCard'
import {
  useChatTaskLiveRefresh,
  useChatTaskMutations,
  useConversationTasks,
  type ConversationTaskFilters,
} from './hooks'

/**
 * The conversation's Tasks section, inside chat's existing contextual region.
 *
 * It shows only links recorded for this conversation, never anything inferred from
 * a shared assignee, a shared project or a text match — and every row is resolved
 * per viewer, so a colleague without task access sees the count of what they cannot
 * read and nothing about it.
 *
 * The region's width, its drag handle, its drawer fallback below the split width and
 * its persistence all come from `ChatContextPanel`; this is only the body.
 */
export function ConversationTasksPanel({
  conversationId,
  onJumpToMessage,
}: {
  conversationId: string
  onJumpToMessage?: (messageId: string) => void
}) {
  const t = useT()
  const [filters, setFilters] = React.useState<ConversationTaskFilters>({
    state: 'open',
    assignedToMe: false,
  })
  const { data, isLoading, error, retry, hasMore, loadMore, isLoadingMore } =
    useConversationTasks(conversationId, filters, true)
  const { unlink, publishCard } = useChatTaskMutations()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  // Both directions: a task changed in Tasks, or a link changed here.
  useChatTaskLiveRefresh()

  const onUnlink = async (linkId: string, hasCard: boolean) => {
    const ok = await confirm({
      title: t('chat_tasks.panel.unlinkTitle', 'Unlink this task?'),
      // Said explicitly, because the three operations are genuinely separate and a
      // dialog that implied otherwise would be the reason somebody lost work.
      description: hasCard
        ? t(
            'chat_tasks.panel.unlinkWithCard',
            'The task itself is not deleted and stays in Tasks. The card is removed from this conversation.',
          )
        : t(
            'chat_tasks.panel.unlinkDescription',
            'The task itself is not deleted and stays in Tasks.',
          ),
      confirmText: t('chat_tasks.panel.unlinkConfirm', 'Unlink'),
    })
    if (!ok) return
    unlink.mutate(
      { linkId, removeCard: hasCard },
      {
        onError: (mutationError) =>
          flash(
            mutationError instanceof Error && mutationError.message
              ? mutationError.message
              : t('chat_tasks.panel.unlinkFailed', 'Could not unlink the task.'),
            'error',
          ),
      },
    )
  }

  return (
    // A stable hook for "this is the linked-tasks panel". The region around it is
    // chat's, and it renders as an aside or a drawer depending on the container width —
    // so a test that keyed on either would be asserting the layout rather than this.
    <div className="space-y-3 p-3" data-chat-tasks-panel="true">
      {/* `SegmentedControl`, not `Tabs`: these three filter one list in one area
          rather than swapping panels — the same call the Shared panel beside it
          makes. `fullWidth` because the region is narrow enough that three hugging
          labels leave the row looking unfinished. */}
      <SegmentedControl
        value={filters.state}
        onValueChange={(next) =>
          setFilters((current) => ({ ...current, state: next as ConversationTaskFilters['state'] }))
        }
        size="sm"
        fullWidth
        aria-label={t('chat_tasks.panel.stateFilter', 'Filter by state')}
      >
        <SegmentedControlItem value="open">
          {t('chat_tasks.panel.open', 'Open')}
        </SegmentedControlItem>
        <SegmentedControlItem value="completed">
          {t('chat_tasks.panel.completed', 'Completed')}
        </SegmentedControlItem>
        <SegmentedControlItem value="all">
          {t('chat_tasks.panel.all', 'All')}
        </SegmentedControlItem>
      </SegmentedControl>

      <Button
        type="button"
        variant={filters.assignedToMe ? 'default' : 'outline'}
        size="sm"
        className="w-full"
        aria-pressed={filters.assignedToMe}
        onClick={() => setFilters((current) => ({ ...current, assignedToMe: !current.assignedToMe }))}
      >
        {t('chat_tasks.panel.assignedToMe', 'Assigned to me')}
        {data ? <span className="ml-1 tabular-nums">({data.counts.assignedToMe})</span> : null}
      </Button>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : error ? (
        <div className="space-y-2">
          <ErrorMessage label={t('chat_tasks.panel.loadFailed', "The linked tasks didn't load")} />
          <Button type="button" variant="outline" size="sm" onClick={() => void retry()}>
            {t('chat_tasks.panel.retry', 'Try again')}
          </Button>
        </div>
      ) : !data || data.items.length === 0 ? (
        <p className="px-1 py-6 text-center text-xs text-muted-foreground">
          {filters.state === 'open'
            ? t('chat_tasks.panel.emptyOpen', 'No open tasks linked to this conversation.')
            : t('chat_tasks.panel.empty', 'No tasks are linked to this conversation yet.')}
        </p>
      ) : (
        <ul className="space-y-2">
          {data.items.map((card) => (
            <li key={card.linkId}>
              <ChatTaskCard card={card} />
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {/* Offered only when the card was never posted. This is the recovery
                    path for the create flow's honest partial success: the task
                    exists, the card does not, and retrying this cannot create a
                    second task. */}
                {card.cardMessageId === null ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={publishCard.isPending}
                    onClick={() =>
                      publishCard.mutate(card.linkId, {
                        onError: (mutationError) =>
                          flash(
                            mutationError instanceof Error && mutationError.message
                              ? mutationError.message
                              : t('chat_tasks.panel.publishFailed', 'Could not post the card.'),
                            'error',
                          ),
                      })
                    }
                  >
                    {t('chat_tasks.panel.postCard', 'Post card')}
                  </Button>
                ) : onJumpToMessage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onJumpToMessage(card.cardMessageId as string)}
                  >
                    {t('chat_tasks.panel.showCard', 'Show in conversation')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={unlink.isPending}
                  onClick={() => void onUnlink(card.linkId, card.cardMessageId !== null)}
                >
                  {t('chat_tasks.panel.unlink', 'Unlink')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* A count rather than a list. It says honestly that there is more here without
          saying what, so the panel cannot be used to enumerate tasks. */}
      {data && data.counts.unavailable > 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          {t('chat_tasks.panel.unavailableCount', '{count} more linked here that you cannot access.', {
            count: data.counts.unavailable,
          })}
        </p>
      ) : null}

      {/* The endpoint pages with a keyset cursor, so there is always a next page to
          ask for. Telling the reader to "narrow the filters" instead was a dead
          end: it left every link past the first page unreachable while the count
          above said they were there. */}
      {hasMore ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={isLoadingMore}
          onClick={() => void loadMore()}
        >
          {isLoadingMore
            ? t('chat_tasks.panel.loadingMore', 'Loading…')
            : t('chat_tasks.panel.loadMore', 'Show older')}
        </Button>
      ) : null}

      {ConfirmDialogElement}
    </div>
  )
}
