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
export function CalendarTaskQuickAdd({
  open,
  dueDate,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  /** The clicked day as `YYYY-MM-DD`, or null to let the composer decide. */
  dueDate: string | null
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const t = useT()

  const handleClose = React.useCallback(() => onOpenChange(false), [onOpenChange])

  const handleCreated = React.useCallback(() => {
    // Close first, then let the caller refetch: the composer stays mounted for
    // the length of the dialog's exit animation otherwise, and a second submit
    // in that window would create a duplicate task.
    onOpenChange(false)
    onCreated()
  }, [onCreated, onOpenChange])

  const context = React.useMemo(
    () => ({ dueDate, onClose: handleClose, onCreated: handleCreated }),
    [dueDate, handleClose, handleCreated],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" closeAriaLabel={t('customers.calendar.tasks.close', 'Close')}>
        <DialogHeader>
          <DialogTitle>{t('customers.calendar.tasks.newTaskTitle', 'New task')}</DialogTitle>
          <DialogDescription>
            {t(
              'customers.calendar.tasks.newTaskSubtitle',
              'Describe the task in plain language — the date, project and assignee are read from what you type.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {/* The spot fills the dialog body directly: the composer's `embedded`
              mode drops its card so the fields sit flush on this surface and its
              action row lines up with the dialog's edges — one modal, not a
              composer parked inside one.

              Keyed by the day, so a dialog dismissed with half-typed text does
              not reopen still holding it, and the newly clicked cell is the date
              that seeds it. Only mounted while open, so the spot is not doing
              work behind a closed dialog. */}
          {open ? (
            <InjectionSpot
              key={dueDate ?? 'no-date'}
              spotId="calendar:task-quick-add"
              context={context}
            />
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
