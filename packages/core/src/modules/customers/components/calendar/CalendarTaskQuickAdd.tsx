"use client"

import * as React from 'react'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import { CalendarMeetingQuickAdd } from './CalendarMeetingQuickAdd'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * The calendar's create-a-task surface.
 *
 * The calendar owns the dialog and the day it opens on. It owns nothing about
 * how a task is authored: the composer arrives through `calendar:task-quick-add`,
 * which the tasks module fills, so the natural-language parsing, the project
 * and assignee mentions, the create call and the permission checks are the Task
 * Manager's own — and stay its own when it changes.
 *
 * The spot is why this file does not import the tasks module. A direct import
 * would make a disabled tasks module break the CRM calendar that hosts it; with
 * injection the spot is simply empty and the dialog renders nothing. The
 * decoupling test in `__tests__/module-decoupling.test.ts` enforces exactly
 * that, and it is what caught this file importing `QuickAddComposer` directly.
 *
 * The day the user clicked is passed as `dueDate`, so the task lands on the
 * cell they picked without them retyping the date. It is a seed, not a lock:
 * typing a different date in the composer still wins.
 */
type QuickAddMode = 'task' | 'meeting'

export function CalendarTaskQuickAdd({
  open,
  dueDate,
  dueTime,
  startTime,
  canCreateMeeting,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  /** The clicked day as `YYYY-MM-DD`, or null to let the composer decide. */
  dueDate: string | null
  /**
   * The clicked hour as `HH:MM`, or null when the click carried no time.
   *
   * Separate from `startTime` on purpose. A meeting always needs a start, so
   * `startTime` falls back to a sensible hour; a task's due time is genuinely
   * optional, and seeding one the user never picked would put a deadline at an
   * hour they did not choose.
   */
  dueTime: string | null
  /** The clicked slot as `HH:MM` — where a meeting would start. */
  startTime: string
  /**
   * Whether this user may create a CRM interaction.
   *
   * Creating a meeting needs `customers.interactions.manage`, which creating a
   * task does not. Without it the endpoint answers Forbidden — correctly — but
   * offering a tab whose only outcome is an error is a trap, so the toggle is
   * hidden and the dialog is the task composer it was before.
   */
  canCreateMeeting: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const t = useT()
  const [mode, setMode] = React.useState<QuickAddMode>('task')

  // A fresh open starts on Task. Carrying the previous choice over would mean
  // the dialog behaves differently depending on something the user did minutes
  // ago and cannot see.
  React.useEffect(() => {
    if (open) setMode('task')
  }, [open])

  // Belt and braces: if the grant disappears while the dialog is open (a role
  // change, a re-check landing late) fall back rather than leave the user in a
  // form that cannot submit.
  React.useEffect(() => {
    if (!canCreateMeeting) setMode('task')
  }, [canCreateMeeting])

  const handleClose = React.useCallback(() => onOpenChange(false), [onOpenChange])

  const handleCreated = React.useCallback(() => {
    // Close first, then let the caller refetch: the composer stays mounted for
    // the length of the dialog's exit animation otherwise, and a second submit
    // in that window would create a duplicate task.
    onOpenChange(false)
    onCreated()
  }, [onCreated, onOpenChange])

  const context = React.useMemo(
    () => ({ dueDate, dueTime, onClose: handleClose, onCreated: handleCreated }),
    [dueDate, dueTime, handleClose, handleCreated],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" closeAriaLabel={t('customers.calendar.tasks.close', 'Close')}>
        <DialogHeader>
          <DialogTitle>
            {mode === 'task'
              ? t('customers.calendar.tasks.newTaskTitle', 'New task')
              : t('customers.calendar.meeting.newMeetingTitle', 'New meeting')}
          </DialogTitle>
          {/* Two lines are reserved whether the copy needs them or not. The
              two modes carry different sentences, and letting the header size
              itself to whichever is showing moved the whole panel by the 20px
              difference between a one-line and a two-line subtitle. */}
          <DialogDescription className="h-10">
            {mode === 'task'
              ? t(
                  'customers.calendar.tasks.newTaskSubtitle',
                  'Describe the task in plain language — the date, project and assignee are read from what you type.',
                )
              : t(
                  'customers.calendar.meeting.newMeetingSubtitle',
                  'Block a slot. You will be warned if it overlaps another meeting.',
                )}
          </DialogDescription>
        </DialogHeader>
        {/* A fixed height, not a min or a max. The dialog is centred in the
            viewport, so every pixel the content grows moves the whole panel by
            half of it — switching Task/Meeting resized it by 15px and shifted
            the very segment the user had just clicked. Pinning the body makes
            the chrome, the toggle and the buttons stay exactly where they are
            for the life of the dialog, whichever mode is showing and whatever
            it has to say; content that outgrows the box scrolls inside it. */}
        <DialogBody className="flex h-[min(72vh,34rem)] min-h-0 flex-col gap-4">
          {/* The toggle sits above both forms and outside either of them, so it
              keeps its position while the body beneath it changes. Putting it
              inside each form would let it shift by a pixel between modes,
              which reads as the dialog flinching on every switch. */}
          {canCreateMeeting ? (
          <SegmentedControl
            className="shrink-0"
            fullWidth
            value={mode}
            onValueChange={(value) => setMode(value as QuickAddMode)}
            aria-label={t('customers.calendar.quickAdd.modeLabel', 'What are you adding?')}
          >
            <SegmentedControlItem value="task">
              {t('customers.calendar.quickAdd.task', 'Task')}
            </SegmentedControlItem>
            <SegmentedControlItem value="meeting">
              {t('customers.calendar.quickAdd.meeting', 'Meeting')}
            </SegmentedControlItem>
          </SegmentedControl>
          ) : null}

          {/* Each mode is mounted only while selected. Both forms hold their own
              drafts, and keeping the hidden one alive would let a half-written
              meeting submit from under a task, or leak its autofocus. */}
          {/* Keyed by mode so the DS's in-place swap animation replays on each
              toggle. The panel is the same size either way, so this is a plain
              cross-fade with nothing moving under it — and it is the existing
              `animate-fadeIn` utility, which already sits out under
              prefers-reduced-motion. */}
          <div key={mode} className="animate-fadeIn flex min-h-0 flex-1 flex-col">
            {open && mode === 'task' ? (
              <InjectionSpot
                key={`${dueDate ?? 'no-date'}T${dueTime ?? 'no-time'}`}
                spotId="calendar:task-quick-add"
                context={context}
              />
            ) : null}
            {open && mode === 'meeting' && dueDate && canCreateMeeting ? (
              <CalendarMeetingQuickAdd
                key={`${dueDate}T${startTime}`}
                day={dueDate}
                startTime={startTime}
                onCancel={handleClose}
                onCreated={handleCreated}
              />
            ) : null}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
