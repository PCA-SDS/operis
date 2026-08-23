"use client"

import { MessageSquare } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { TaskListItemDto } from '../data/types'
import { AssigneeSummary, LabelPill, ParentTaskRef, PriorityFlag, SubtaskProgress } from './badges'
import { formatDueChip, isOverdue, taskRef } from './format'
import { FLASH_ROW_CLASS } from './useNewTaskFlash'

const MAX_LABELS = 3

/** The board card. Everything on it is secondary to the title, which is the
 *  only thing a person scanning a column actually reads. */
export function TaskCard({
  task,
  onOpen,
  interaction = 'open',
  overlay = false,
  isFlashing = false,
  flashRef,
}: {
  task: TaskListItemDto
  onOpen: (id: string) => void
  interaction?: 'drag' | 'open'
  overlay?: boolean
  isFlashing?: boolean
  flashRef?: ((node: HTMLElement | null) => void) | null
}) {
  const t = useT()
  const overdue = isOverdue(task.dueDate) && task.status !== 'done'
  const hasFooter = !!task.dueDate || task.commentCount > 0 || task.subtaskCount > 0

  return (
    <button
      ref={flashRef ?? undefined}
      type="button"
      onClick={() => onOpen(task.id)}
      className={cn(
        'w-full space-y-2 rounded-lg border border-border bg-surface p-2.5 text-left transition-all duration-700 hover:shadow-md focus:outline-none focus-visible:shadow-focus',
        isFlashing && FLASH_ROW_CLASS,
        interaction === 'drag' ? (overlay ? 'cursor-grabbing shadow-lg' : 'cursor-grab') : 'cursor-pointer',
      )}
    >
      <p className="line-clamp-3 text-sm font-medium leading-snug text-foreground">
        {task.parent && (
          <span className="mr-1 inline-flex translate-y-0.5">
            <ParentTaskRef projectKey={task.projectKey} parent={task.parent} />
          </span>
        )}
        {task.title}
      </p>

      {task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.labels.slice(0, MAX_LABELS).map((label) => (
            <LabelPill key={label.id} label={label} />
          ))}
          {task.labels.length > MAX_LABELS && (
            <span className="text-overline text-muted-foreground">
              {t('tasks.common.more', '+{count}', { count: task.labels.length - MAX_LABELS })}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-overline text-muted-foreground">
          {task.priority !== 'none' && <PriorityFlag priority={task.priority} />}
          <span className="truncate font-mono">{taskRef(task.projectKey, task.number)}</span>
        </span>
        <AssigneeSummary assignees={task.assignees} targets={task.assignmentTargets} max={2} />
      </div>

      {hasFooter && (
        <div className="flex items-center gap-2 text-overline text-muted-foreground">
          {task.dueDate && (
            <span
              className={cn(
                'rounded px-1.5 py-0.5',
                overdue ? 'bg-status-error-bg font-medium text-status-error-text' : 'bg-surface-muted',
              )}
            >
              {formatDueChip(t, task.dueDate)}
            </span>
          )}
          <SubtaskProgress done={task.subtaskDoneCount} total={task.subtaskCount} />
          {task.commentCount > 0 && (
            <span className="flex items-center gap-0.5">
              <MessageSquare className="size-3" aria-hidden="true" />
              {task.commentCount}
            </span>
          )}
        </div>
      )}
    </button>
  )
}
