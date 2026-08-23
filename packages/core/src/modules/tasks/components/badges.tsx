"use client"

import * as React from 'react'
import { CornerDownRight, Flag, ListTree, Users, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type {
  LabelDto,
  TaskAssignmentTargetDto,
  TaskParentRefDto,
  TaskPriority,
  TaskStatus,
  TaskUserDto,
} from '../data/types'
import { StatusIcon } from './StatusIcon'
import { CountBadge, UserAvatar } from './ui-bits'
import { TASK_PRIORITY_META, TASK_STATUS_META, taskRef } from './format'

const CHIP_SIZE = {
  sm: 'h-5 gap-1 px-1.5 text-overline',
  md: 'h-8 gap-1.5 px-2.5 text-sm',
} as const

export type ChipSize = keyof typeof CHIP_SIZE

/** The dashed "add" affordance the assign and label pickers share. */
export const CHIP_ADD_CLASS =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border bg-surface px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:shadow-focus'

export function Chip({
  children,
  onRemove,
  removeLabel,
  title,
  size = 'sm',
}: {
  children: React.ReactNode
  onRemove?: () => void
  removeLabel?: string
  title?: string
  size?: ChipSize
}) {
  const t = useT()
  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-full items-center rounded-full border border-border bg-surface text-muted-foreground',
        CHIP_SIZE[size],
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel ?? t('tasks.common.remove', 'Remove')}
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          className="-mr-0.5 shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          <X className={size === 'md' ? 'size-3' : 'size-2.5'} aria-hidden="true" />
        </button>
      )}
    </span>
  )
}

/** Column heading on the board and the grouped list: glyph, label, count. */
export function StatusHeadline({ status, count }: { status: TaskStatus; count: number }) {
  const t = useT()
  const meta = TASK_STATUS_META[status]
  return (
    <>
      <StatusIcon status={status} />
      <span className={cn('text-xs font-bold uppercase tracking-widest', meta.textClass)}>
        {t(meta.labelKey, meta.fallback)}
      </span>
      <CountBadge value={count} />
    </>
  )
}

export function StatusBadge({ status, size = 'md' }: { status: TaskStatus; size?: 'sm' | 'md' }) {
  const t = useT()
  const meta = TASK_STATUS_META[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded font-medium',
        size === 'sm' ? 'px-1.5 py-0.5 text-overline' : 'px-2 py-1 text-xs',
        meta.bgClass,
        meta.textClass,
      )}
    >
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full"
        style={{ backgroundColor: meta.colorVar }}
      />
      {t(meta.labelKey, meta.fallback)}
    </span>
  )
}

export function PriorityFlag({
  priority,
  withLabel = false,
  className = 'size-3.5',
}: {
  priority: TaskPriority
  withLabel?: boolean
  className?: string
}) {
  const t = useT()
  const meta = TASK_PRIORITY_META[priority]
  const label = t(meta.labelKey, meta.fallback)
  return (
    <span
      className="inline-flex items-center gap-1 text-xs"
      title={t('tasks.priority.label', 'Priority: {priority}', { priority: label })}
    >
      <Flag
        className={className}
        style={{ color: meta.colorVar }}
        fill={meta.flagged ? meta.colorVar : 'none'}
        aria-hidden="true"
      />
      {withLabel && <span style={{ color: meta.colorVar }}>{label}</span>}
    </span>
  )
}

/** The "1/3" child-progress counter. Turns primary once every subtask is done —
 *  the one moment the number is worth noticing. */
export function SubtaskProgress({ done, total }: { done: number; total: number }) {
  const t = useT()
  if (total === 0) return null
  return (
    <span
      title={t('tasks.common.subtaskProgress', '{done} of {total} subtasks done', { done, total })}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-overline tabular-nums',
        done === total ? 'font-medium text-primary' : 'text-muted-foreground',
      )}
    >
      <ListTree className="size-3" aria-hidden="true" />
      {done}/{total}
    </span>
  )
}

/** A glyph marking a row as a subtask. Carries its parent in the tooltip and
 *  for screen readers rather than spending row width on it. */
export function ParentTaskRef({
  projectKey,
  parent,
}: {
  projectKey: string
  parent: TaskParentRefDto
}) {
  const t = useT()
  const label = t('tasks.common.subtaskOf', 'Subtask of {ref} {title}', {
    ref: taskRef(projectKey, parent.number),
    title: parent.title,
  })
  return (
    <span title={label} className="inline-flex shrink-0 items-center text-muted-foreground">
      <CornerDownRight className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function TargetChip({ target }: { target: TaskAssignmentTargetDto }) {
  const t = useT()
  const name = target.role?.name
  if (!name) return null
  return (
    <Chip title={t('tasks.common.roleTarget', 'Role: {name}', { name })}>
      <Users className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </Chip>
  )
}

export function AvatarStack({ people, max = 3 }: { people: TaskUserDto[]; max?: number }) {
  const t = useT()
  if (people.length === 0) return null
  const shown = people.slice(0, max)
  const extra = people.length - shown.length
  return (
    <span className="inline-flex items-center gap-1">
      <span className="flex -space-x-1.5">
        {shown.map((person) => (
          <span key={person.id} className="rounded-full ring-2 ring-surface" title={person.name}>
            <UserAvatar name={person.name} size="xs" />
          </span>
        ))}
      </span>
      {extra > 0 && (
        <span className="text-overline text-muted-foreground">
          {t('tasks.common.more', '+{count}', { count: extra })}
        </span>
      )}
    </span>
  )
}

/** Who a task belongs to: faces for named people, chips for role audiences. */
export function AssigneeSummary({
  assignees,
  targets,
  max = 3,
}: {
  assignees: TaskUserDto[]
  targets: TaskAssignmentTargetDto[]
  max?: number
}) {
  if (assignees.length === 0 && targets.length === 0) return null
  return (
    <span className="inline-flex items-center gap-1">
      <AvatarStack people={assignees} max={max} />
      {targets.map((target, index) => (
        <TargetChip key={target.role?.id ?? `${target.kind}-${index}`} target={target} />
      ))}
    </span>
  )
}

export function LabelPill({
  label,
  onRemove,
  size = 'sm',
}: {
  label: Pick<LabelDto, 'name' | 'color'>
  onRemove?: () => void
  size?: ChipSize
}) {
  const t = useT()
  return (
    <Chip
      onRemove={onRemove}
      removeLabel={t('tasks.labels.remove', 'Remove {name}', { name: label.name })}
      size={size}
    >
      <span
        aria-hidden="true"
        className={cn('shrink-0 rounded-full', size === 'md' ? 'size-2.5' : 'size-2')}
        style={{ backgroundColor: label.color }}
      />
      <span className="truncate">{label.name}</span>
    </Chip>
  )
}
