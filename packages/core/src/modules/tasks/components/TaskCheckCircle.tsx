"use client"

import { Check } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { TaskPriority } from '../data/types'
import { TASK_PRIORITY_META } from './format'

const BASE =
  'flex size-5 shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:shadow-focus disabled:opacity-50'

/**
 * The tick-off control on completed-work rows. Open tasks show an empty ring
 * that borrows the priority colour, so the thing you are most likely to tick
 * next is also the one that catches the eye.
 */
export function TaskCheckCircle({
  done,
  priority,
  disabled,
  taskTitle,
  className,
  onClick,
}: {
  done: boolean
  priority?: TaskPriority
  disabled?: boolean
  taskTitle: string
  className?: string
  onClick: () => void
}) {
  const t = useT()
  const meta = priority ? TASK_PRIORITY_META[priority] : null

  if (done) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={t('tasks.completed.reopenLabel', 'Reopen {title}', { title: taskTitle })}
        title={t('tasks.completed.reopen', 'Reopen')}
        className={cn(BASE, 'bg-primary text-primary-foreground hover:opacity-70', className)}
      >
        <Check className="size-3" aria-hidden="true" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={t('tasks.completed.completeLabel', 'Complete {title}', { title: taskTitle })}
      title={t('tasks.completed.complete', 'Complete')}
      className={cn('group/check border hover:bg-primary-soft', BASE, className)}
      style={{ borderColor: meta?.flagged ? meta.colorVar : undefined }}
    >
      <Check
        className="size-3 text-transparent transition-colors group-hover/check:text-primary"
        aria-hidden="true"
      />
    </button>
  )
}
