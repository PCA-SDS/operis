"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useInboxProject } from '../../components/hooks'
import { TaskPanel } from '../../components/TaskPanel'

/**
 * The task editor, contributed to any calendar that asks for one.
 *
 * A calendar lives in another module and must not import this one — disabling
 * tasks would then break its host. Injection inverts that: the host renders an
 * empty spot, and this module fills it when it is active, so the calendar shows
 * the Task Manager's real panel (same fields, same validation, same status and
 * assignment controls, same permissions) without a second task form existing
 * anywhere.
 */
export type CalendarTaskEditorContext = {
  /** The task to edit, or null to create one. */
  id: string | null
  /** Where a new task goes; defaults to the Inbox, as Quick Add does. */
  projectId?: string | null
  /** Seeds a new task from the slot the calendar was clicked on. */
  dueDate?: string | null
  dueTime?: string | null
  onClose: () => void
}

function isValidContext(context: unknown): context is CalendarTaskEditorContext {
  if (!context || typeof context !== 'object') return false
  const candidate = context as { id?: unknown; onClose?: unknown }
  if (candidate.id !== null && typeof candidate.id !== 'string') return false
  return typeof candidate.onClose === 'function'
}

export function CalendarTaskEditorWidget({
  context,
}: InjectionWidgetComponentProps<unknown, unknown>) {
  const { inbox } = useInboxProject()
  if (!isValidContext(context)) return null

  // Editing knows its project from the task; creating falls back to the Inbox,
  // the same home Quick Add gives unfiled work. Until it resolves there is
  // nothing to render rather than a panel pointed at no project.
  const projectId = context.projectId ?? inbox?.id ?? null
  if (!projectId) return null

  return (
    <TaskPanel
      taskId={context.id}
      projectId={projectId}
      defaultDueDate={context.dueDate ?? null}
      defaultDueTime={context.dueTime ?? null}
      onClose={context.onClose}
    />
  )
}

export default CalendarTaskEditorWidget
