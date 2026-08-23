"use client"

import * as React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  MILESTONE_STATUSES,
  TASK_PRIORITIES,
  TASK_RECURRENCE_FREQUENCIES,
  type AssignableUserDto,
  type MilestoneDto,
  type MilestoneStatus,
  type TaskPriority,
  type TaskRecurrenceDto,
  type TaskRecurrenceFrequency,
} from '../data/types'
import { MILESTONE_STATUS_META, TASK_PRIORITY_META } from './format'

/** The sentinel a Select uses for "nothing chosen" — Radix treats an empty
 *  string value as "no selection" and would render the placeholder forever. */
const NONE = '__none__'

type PickerSize = 'sm' | 'default'

function pickerSize(dense: boolean | undefined): PickerSize {
  return dense ? 'sm' : 'default'
}

export function TaskPriorityPicker({
  value,
  onChange,
  dense,
}: {
  value: TaskPriority
  onChange: (next: TaskPriority) => void
  dense?: boolean
}) {
  const t = useT()
  return (
    <Select value={value} onValueChange={(next) => onChange(next as TaskPriority)}>
      <SelectTrigger size={pickerSize(dense)} aria-label={t('tasks.panel.priority', 'Priority')}>
        <SelectValue placeholder={t('tasks.priority.placeholder', 'Priority')} />
      </SelectTrigger>
      <SelectContent>
        {TASK_PRIORITIES.map((priority) => {
          const meta = TASK_PRIORITY_META[priority]
          return (
            <SelectItem key={priority} value={priority}>
              {t(meta.labelKey, meta.fallback)}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

export function MilestoneStatusPicker({
  value,
  onChange,
  dense,
}: {
  value: MilestoneStatus
  onChange: (next: MilestoneStatus) => void
  dense?: boolean
}) {
  const t = useT()
  return (
    <Select value={value} onValueChange={(next) => onChange(next as MilestoneStatus)}>
      <SelectTrigger size={pickerSize(dense)} aria-label={t('tasks.milestones.status', 'Status')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MILESTONE_STATUSES.map((status) => {
          const meta = MILESTONE_STATUS_META[status]
          return (
            <SelectItem key={status} value={status}>
              {t(meta.labelKey, meta.fallback)}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

export function UserPicker({
  value,
  onChange,
  users,
  unassignedLabel,
  dense,
}: {
  value: string | null
  onChange: (next: string | null) => void
  users: AssignableUserDto[]
  unassignedLabel?: string
  dense?: boolean
}) {
  const t = useT()
  const placeholder = unassignedLabel ?? t('tasks.common.unassigned', 'Unassigned')
  return (
    <Select
      value={value ?? NONE}
      onValueChange={(next) => onChange(next === NONE ? null : next)}
    >
      <SelectTrigger size={pickerSize(dense)} aria-label={placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {users.map((user) => (
          <SelectItem key={user.id} value={user.id}>
            {user.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const RECURRENCE_LABELS: Record<TaskRecurrenceFrequency, { key: string; fallback: string }> = {
  daily: { key: 'tasks.recurrence.daily', fallback: 'Every day' },
  weekdays: { key: 'tasks.recurrence.weekdays', fallback: 'Every weekday' },
  weekly: { key: 'tasks.recurrence.weekly', fallback: 'Every week' },
  monthly: { key: 'tasks.recurrence.monthly', fallback: 'Every month' },
}

/**
 * Picks only the frequency. The weekday and day-of-month anchors are derived
 * server-side from the task's due date, so a user never has to state twice
 * which day "every week" means.
 */
export function RecurrencePicker({
  value,
  onChange,
  dense,
}: {
  value: TaskRecurrenceDto | null
  onChange: (next: TaskRecurrenceDto | null) => void
  dense?: boolean
}) {
  const t = useT()
  const noneLabel = t('tasks.recurrence.none', "Doesn't repeat")
  return (
    <Select
      value={value?.freq ?? NONE}
      onValueChange={(next) =>
        onChange(next === NONE ? null : { freq: next as TaskRecurrenceFrequency })
      }
    >
      <SelectTrigger size={pickerSize(dense)} aria-label={t('tasks.panel.repeats', 'Repeats')}>
        <SelectValue placeholder={noneLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {TASK_RECURRENCE_FREQUENCIES.map((freq) => (
          <SelectItem key={freq} value={freq}>
            {t(RECURRENCE_LABELS[freq].key, RECURRENCE_LABELS[freq].fallback)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function MilestonePicker({
  value,
  onChange,
  milestones,
  dense,
}: {
  value: string | null
  onChange: (next: string | null) => void
  milestones: MilestoneDto[]
  dense?: boolean
}) {
  const t = useT()
  const noneLabel = t('tasks.milestones.none', 'No milestone')
  return (
    <Select
      value={value ?? NONE}
      onValueChange={(next) => onChange(next === NONE ? null : next)}
    >
      <SelectTrigger size={pickerSize(dense)} aria-label={t('tasks.milestones.picker', 'Milestone')}>
        <SelectValue placeholder={noneLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {milestones.map((milestone) => (
          <SelectItem key={milestone.id} value={milestone.id}>
            {milestone.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ProjectPicker({
  value,
  onChange,
  projects,
  inboxLabel,
  dense,
}: {
  value: string
  onChange: (next: string) => void
  projects: { id: string; name: string; icon: string; isInbox: boolean }[]
  inboxLabel: string
  dense?: boolean
}) {
  const options = React.useMemo(() => projects.filter((project) => !project.isInbox), [projects])
  return (
    <Select value={value || NONE} onValueChange={(next) => onChange(next === NONE ? '' : next)}>
      <SelectTrigger size={pickerSize(dense)} aria-label={inboxLabel}>
        <SelectValue placeholder={inboxLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{inboxLabel}</SelectItem>
        {options.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {`${project.icon} ${project.name}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
