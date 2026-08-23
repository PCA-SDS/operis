"use client"

import { Minus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { TaskListItemDto, TaskStatus } from '../data/types'
import { AssigneeSummary, LabelPill, ParentTaskRef, SubtaskProgress } from './badges'
import { PriorityBars } from './PriorityBars'
import { StatusIcon } from './StatusIcon'
import { StatusSelect } from './StatusSelect'
import { CARD_ROW_CLASS } from './ui-bits'
import { formatTaskDate, isOverdue, taskRef } from './format'
import { FLASH_ROW_CLASS } from './useNewTaskFlash'

const MAX_LABELS = 3

/**
 * The dense list row. Priority and status sit at the left edge as fixed-width
 * glyphs so the eye can run down either column; everything after the title is
 * progressively dropped on narrow screens.
 */
export function TaskListRow({
  task,
  onOpen,
  onStatusChange,
  selected = false,
  isFlashing = false,
  flashRef,
}: {
  task: TaskListItemDto
  onOpen: () => void
  onStatusChange?: (status: TaskStatus) => void
  selected?: boolean
  isFlashing?: boolean
  flashRef?: ((node: HTMLElement | null) => void) | null
}) {
  const t = useT()
  const overdue = isOverdue(task.dueDate) && task.status !== 'done'

  return (
    <li
      ref={flashRef ?? undefined}
      className={cn(
        CARD_ROW_CLASS,
        'transition-colors duration-700',
        isFlashing ? FLASH_ROW_CLASS : selected ? 'bg-table-selected' : 'hover:bg-surface-muted',
      )}
    >
      {task.priority !== 'none' ? (
        <PriorityBars priority={task.priority} className="size-3.5" />
      ) : (
        <Minus
          className="size-3.5 shrink-0 text-disabled-foreground"
          aria-label={t('tasks.common.noPriority', 'No priority')}
        />
      )}

      {onStatusChange ? (
        <StatusSelect value={task.status} onChange={onStatusChange} variant="icon" />
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center">
          <StatusIcon status={task.status} />
        </span>
      )}

      <span className="w-17 shrink-0 truncate font-mono text-xs text-muted-foreground">
        {taskRef(task.projectKey, task.number)}
      </span>

      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {task.parent && <ParentTaskRef projectKey={task.projectKey} parent={task.parent} />}
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            'min-w-0 flex-1 truncate text-left text-sm focus:outline-none focus-visible:shadow-focus',
            task.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground',
          )}
        >
          {task.title}
        </button>
      </span>

      <SubtaskProgress done={task.subtaskDoneCount} total={task.subtaskCount} />

      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        {task.labels.slice(0, MAX_LABELS).map((label) => (
          <LabelPill key={label.id} label={label} />
        ))}
        {task.labels.length > MAX_LABELS && (
          <span className="text-overline text-muted-foreground">
            {t('tasks.common.more', '+{count}', { count: task.labels.length - MAX_LABELS })}
          </span>
        )}
      </div>

      {/* The due column keeps its width even when empty so titles stay aligned
          down the list rather than jumping around the rows that have a date. */}
      <span
        className={cn(
          'hidden w-22 shrink-0 text-right text-xs tabular-nums sm:block',
          !task.dueDate
            ? 'text-transparent'
            : overdue
              ? 'font-medium text-status-error-text'
              : 'text-muted-foreground',
        )}
      >
        {task.dueDate ? formatTaskDate(task.dueDate) : '—'}
      </span>

      <div className="flex w-14 shrink-0 justify-end">
        <AssigneeSummary assignees={task.assignees} targets={task.assignmentTargets} max={2} />
      </div>
    </li>
  )
}
