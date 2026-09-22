"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useCurrentUserId } from '@open-mercato/ui/backend/utils/useCurrentUserId'
import { QuickAddComposer } from '../../components/QuickAddComposer'

/**
 * Quick Add, contributed to any calendar that asks for one.
 *
 * Sibling of `calendar-task-editor`, and the same inversion for the same
 * reason: a calendar lives in another module and must not import this one, or
 * disabling tasks would break its host. The host renders an empty spot and this
 * module fills it, so the calendar gets the Task Manager's real composer —
 * natural-language parsing, project and assignee mentions, recurrence, the same
 * create call and the same permissions — without a second task form existing
 * anywhere.
 *
 * Where the editor spot renders the full `TaskPanel`, this one renders the
 * composer: the calendar's create-from-a-grid-click flow wants one line of
 * text, not a form.
 */
export type CalendarTaskQuickAddContext = {
  /** Seeds the due date from the grid cell that was clicked, `YYYY-MM-DD`. */
  dueDate?: string | null
  /** The dialog asked to close — dismissed, or cancelled from inside. */
  onClose: () => void
  /** A task was created; the host reloads its lane. */
  onCreated: () => void
}

function isValidContext(context: unknown): context is CalendarTaskQuickAddContext {
  if (!context || typeof context !== 'object') return false
  const candidate = context as { dueDate?: unknown; onClose?: unknown; onCreated?: unknown }
  if (
    candidate.dueDate !== undefined &&
    candidate.dueDate !== null &&
    typeof candidate.dueDate !== 'string'
  ) {
    return false
  }
  return typeof candidate.onClose === 'function' && typeof candidate.onCreated === 'function'
}

export function CalendarTaskQuickAddWidget({
  context,
}: InjectionWidgetComponentProps<unknown, unknown>) {
  const currentUserId = useCurrentUserId()

  // A malformed context renders nothing rather than a composer wired to
  // callbacks that do not exist.
  if (!isValidContext(context)) return null

  /* Wait for the id before mounting.
   *
   * The composer resolves `defaultAssigneeId` at read time, so an id that
   * arrives late is still picked up — this is not about the seed sticking.
   * It is about the race: submitting in the beat before the id lands would
   * create an unassigned task, and the calendar lane only shows tasks assigned
   * to the caller, so it would vanish from the calendar that created it.
   *
   * Holding costs one short beat with the dialog header already on screen. */
  if (!currentUserId) return null

  return (
    <QuickAddComposer
      autoFocus
      // The host is a dialog that already owns the surface, the padding and the
      // close affordance, so the composer drops its own card chrome and renders
      // as part of that dialog rather than as a panel dropped inside one.
      embedded
      defaultDueDate={context.dueDate ?? null}
      // The user added a task from the calendar; they did not ask to leave it.
      // Without this the composer pushes to /backend/tasks/all on success and
      // the calendar disappears out from under them.
      navigateOnCreate={false}
      // The calendar lane is `my-tasks`: the endpoint behind it returns only
      // tasks assigned to the caller. An unassigned task would be created
      // successfully and then never appear on the calendar that created it,
      // which reads as a silent failure. Seeding the assignee is still only a
      // default — the control can reassign or clear it before submitting.
      defaultAssigneeId={currentUserId || null}
      onClose={context.onClose}
      onCreated={context.onCreated}
    />
  )
}

export default CalendarTaskQuickAddWidget
