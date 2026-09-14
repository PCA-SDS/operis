"use client"

import * as React from 'react'
import Link from 'next/link'
import { Check, CircleSlash, ExternalLink, RotateCcw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { TASK_TERMINAL_STATUSES } from '@open-mercato/core/modules/tasks/data/types'
import type { ChatTaskCardDto } from '../data/types'
import { useChatTaskMutations } from './hooks'
import { browserTimeZone } from './format'

/**
 * A task, as it appears inside a conversation.
 *
 * Everything it shows comes from an authorized read done **for the reader looking
 * at it**, so two people can sit in the same conversation and see different things:
 * one sees the task, the other sees that something is linked here and nothing about
 * what. That is the whole security model of this component, and it is why the card
 * takes a DTO that is either complete or empty — there is no shape in which it can
 * render half a task.
 */
export function ChatTaskCard({
  card,
  isLoading,
  className,
  onOpenSource,
}: {
  card: ChatTaskCardDto | null
  isLoading?: boolean
  className?: string
  /** Present in the panel, absent in the transcript, where the card already is the message. */
  onOpenSource?: () => void
}) {
  const t = useT()
  const { complete, reopen } = useChatTaskMutations()

  if (isLoading) {
    return (
      <div className={cn('rounded-lg border border-border bg-surface p-3', className)}>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-4 w-full" />
      </div>
    )
  }

  /**
   * The unavailable state, and it is deliberately almost empty.
   *
   * No reference, no project, no assignee, no status, no tooltip and no
   * accessibility label carrying any of them — a sentence that said "ENG-42 is not
   * available to you" would leak the reference it was refusing to show. What is
   * left is the honest minimum: something is linked here, and it is not yours to
   * read.
   */
  if (!card || !card.available || !card.task) {
    return (
      <div
        className={cn('rounded-lg border border-border bg-surface px-3 py-2', className)}
        data-chat-task-card="unavailable"
      >
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <CircleSlash className="size-3.5 shrink-0" aria-hidden="true" />
          {t('chat_tasks.card.unavailable', 'A task is linked here that you do not have access to.')}
        </p>
      </div>
    )
  }

  const task = card.task
  const isTerminal = (TASK_TERMINAL_STATUSES as readonly string[]).includes(task.status)
  const isRecurring = task.recurrence !== null
  const busy = complete.isPending || reopen.isPending

  const onComplete = () => {
    complete.mutate(
      { taskId: task.id, tz: browserTimeZone() ?? 'UTC', updatedAt: task.updatedAt },
      {
        onSuccess: (result) => {
          /**
           * What the task actually became, not what was asked for.
           *
           * Completing a recurring task does not complete it — the tasks module rolls
           * it to its next occurrence and resets it to `pending`. Reporting "done"
           * here would be a lie the card then contradicts on its next refetch, so the
           * message is chosen from the status that came back.
           */
          const advanced = result && result.status !== 'done'
          flash(
            advanced
              ? t('chat_tasks.card.advanced', 'Done for now — this task repeats, so it is scheduled again.')
              : t('chat_tasks.card.completed', 'Task completed.'),
            'success',
          )
        },
        onError: (error) =>
          flash(
            error instanceof Error && error.message
              ? error.message
              : t('chat_tasks.card.completeFailed', 'Could not update the task.'),
            'error',
          ),
      },
    )
  }

  const onReopen = () => {
    reopen.mutate(
      { taskId: task.id, updatedAt: task.updatedAt },
      {
        onError: (error) =>
          flash(
            error instanceof Error && error.message
              ? error.message
              : t('chat_tasks.card.reopenFailed', 'Could not reopen the task.'),
            'error',
          ),
      },
    )
  }

  return (
    <div
      className={cn('rounded-lg border border-border bg-surface p-3', className)}
      data-chat-task-card="available"
      data-task-id={task.id}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{task.reference}</span>
            <span aria-hidden="true">·</span>
            <span>{t(`chat_tasks.status.${task.status}`, task.status)}</span>
            {isRecurring ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{t('chat_tasks.card.repeats', 'Repeats')}</span>
              </>
            ) : null}
          </p>
          <p className="mt-0.5 break-words text-sm font-medium text-foreground">{task.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {task.assignees.length > 0 ? (
              <span>{task.assignees.map((person) => person.name).join(', ')}</span>
            ) : task.assignmentTargetCount > 0 ? (
              // A count, not the role names: a card needs to say "a role owns this"
              // and the names belong on the task surface where they can be changed.
              <span>{t('chat_tasks.card.roleAssigned', 'Assigned to a role')}</span>
            ) : (
              <span>{t('chat_tasks.card.unassigned', 'Unassigned')}</span>
            )}
            {task.dueDate ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {task.dueTime
                    ? t('chat_tasks.card.dueAt', 'Due {date} at {time}', {
                        date: task.dueDate,
                        time: task.dueTime,
                      })
                    : t('chat_tasks.card.due', 'Due {date}', { date: task.dueDate })}
                </span>
              </>
            ) : null}
            {task.priority !== 'none' ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{t(`chat_tasks.priority.${task.priority}`, task.priority)}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* A real link to the module's own detail panel, on a route the tasks
            module already serves — never a URL this module invented. */}
        <Button asChild type="button" variant="outline" size="sm">
          <Link href={task.href}>
            <ExternalLink className="size-3.5" aria-hidden="true" />
            {t('chat_tasks.card.open', 'Open task')}
          </Link>
        </Button>

        {/* Shown only when the viewer may actually edit. A greyed control that
            answers 403 is the dead end this avoids. */}
        {task.canEdit ? (
          isTerminal ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onReopen}>
              <RotateCcw className="size-3.5" aria-hidden="true" />
              {t('chat_tasks.card.reopen', 'Reopen')}
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onComplete}>
              <Check className="size-3.5" aria-hidden="true" />
              {isRecurring
                ? t('chat_tasks.card.completeOccurrence', 'Done for now')
                : t('chat_tasks.card.complete', 'Complete')}
            </Button>
          )
        ) : null}

        {onOpenSource ? (
          <Button type="button" variant="ghost" size="sm" onClick={onOpenSource}>
            {t('chat_tasks.card.showMessage', 'Show message')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
