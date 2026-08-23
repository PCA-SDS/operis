"use client"

import * as React from 'react'
import { MessageSquare } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { TaskListItemDto } from '../data/types'
import { AssigneeSummary, LabelPill } from './badges'
import { TaskCheckCircle } from './TaskCheckCircle'
import {
  CARD_CAPTION_CLASS,
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CARD_ROW_CLASS,
  CountBadge,
  ErrorState,
  SkeletonBlock,
} from './ui-bits'
import { formatDayHeading, formatTaskTimeOfDay, localDayOf, taskRef } from './format'
import { useBoard, useTaskError, useTaskMutations } from './hooks'

/** The project's finished work as a dated log, newest first — a record of what
 *  happened rather than another list of things to do. */
export function CompletedTab({
  projectId,
  onOpenTask,
}: {
  projectId: string
  onOpenTask: (id: string) => void
}) {
  const t = useT()
  const { tasks, isLoading, error, retry } = useBoard(projectId)
  const errorMessage = useTaskError(error, t('tasks.common.loadFailed', "This didn't load"))
  const { reopen } = useTaskMutations(projectId)

  const groups = React.useMemo(() => {
    const done = tasks
      .filter((task) => task.status === 'done')
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    const byDay = new Map<string, TaskListItemDto[]>()
    for (const task of done) {
      const key = localDayOf(task.completedAt)
      const bucket = byDay.get(key)
      if (bucket) bucket.push(task)
      else byDay.set(key, [task])
    }
    return [...byDay.entries()]
  }, [tasks])

  if (errorMessage) return <ErrorState message={errorMessage} onRetry={retry} size="lg" />
  if (isLoading) return <SkeletonBlock className="h-96" />

  if (groups.length === 0) {
    return (
      <EmptyState
        size="lg"
        variant="subtle"
        title={t('tasks.completed.empty', 'Nothing completed yet')}
        description={t(
          'tasks.completed.emptyHint',
          'Tasks you finish in this project land here, most recent first.',
        )}
      />
    )
  }

  const onReopen = (task: TaskListItemDto) =>
    reopen.mutate(
      { id: task.id, updatedAt: task.updatedAt },
      {
        onSuccess: () =>
          flash(
            t('tasks.completed.reopened', '{ref} reopened.', {
              ref: taskRef(task.projectKey, task.number),
            }),
            'success',
          ),
        onError: () => flash(t('tasks.completed.reopenFailed', 'Could not reopen the task.'), 'error'),
      },
    )

  return (
    <div className={CARD_CLASS}>
      {groups.map(([day, rows]) => (
        <section key={day}>
          <h3 className={CARD_HEADER_CLASS}>
            <span className={CARD_CAPTION_CLASS}>
              {day ? formatDayHeading(t, day) : t('tasks.completed.earlier', 'Earlier')}
            </span>
            <CountBadge value={rows.length} />
          </h3>
          <ul className="divide-y divide-border">
            {rows.map((task) => (
              <li key={task.id} className={cn(CARD_ROW_CLASS, 'transition-colors hover:bg-surface-muted')}>
                <TaskCheckCircle
                  done
                  disabled={reopen.isPending}
                  taskTitle={task.title}
                  onClick={() => onReopen(task)}
                />

                <span className="w-17 shrink-0 truncate font-mono text-xs text-muted-foreground">
                  {taskRef(task.projectKey, task.number)}
                </span>

                <button
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                  className="min-w-0 flex-1 truncate text-left text-sm text-muted-foreground line-through focus:outline-none focus-visible:shadow-focus"
                >
                  {task.title}
                </button>

                <div className="flex shrink-0 items-center gap-2">
                  {task.labels.slice(0, 2).map((label) => (
                    <LabelPill key={label.id} label={label} />
                  ))}
                  {task.commentCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <MessageSquare className="size-3" aria-hidden="true" />
                      {task.commentCount}
                    </span>
                  )}
                  <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                    {formatTaskTimeOfDay(task.completedAt)}
                  </span>
                  <AssigneeSummary
                    assignees={task.assignees}
                    targets={task.assignmentTargets}
                    max={2}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
