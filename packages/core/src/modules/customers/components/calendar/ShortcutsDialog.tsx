"use client"

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Kbd } from '@open-mercato/ui/primitives/kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * Every global calendar shortcut, in the order the dialog lists them.
 *
 * The keys themselves are bound in `CalendarScreen`; this is the legend, and
 * the dialog is now the only place it appears — a permanent footer rail of
 * eight key chips cost the grid a band of height to teach something a user
 * learns once.
 */
export const CALENDAR_SHORTCUTS: ReadonlyArray<{
  key: string
  labelKey: string
  fallback: string
}> = [
  { key: 'T', labelKey: 'customers.calendar.shortcuts.today', fallback: 'Today' },
  { key: 'D', labelKey: 'customers.calendar.shortcuts.dayView', fallback: 'Day view' },
  { key: 'W', labelKey: 'customers.calendar.shortcuts.week', fallback: 'Week' },
  { key: 'M', labelKey: 'customers.calendar.shortcuts.month', fallback: 'Month' },
  { key: 'A', labelKey: 'customers.calendar.shortcuts.agenda', fallback: 'Agenda' },
  { key: 'N', labelKey: 'customers.calendar.shortcuts.newEvent', fallback: 'New event' },
  { key: '/', labelKey: 'customers.calendar.shortcuts.search', fallback: 'Search' },
  { key: '?', labelKey: 'customers.calendar.shortcuts.help', fallback: 'Shortcuts' },
]

export type ShortcutsDialogProps = {
  open: boolean
  onOpenChange(open: boolean): void
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            onOpenChange(false)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t('customers.calendar.shortcuts.title', 'Keyboard shortcuts')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'customers.calendar.shortcuts.description',
              'Navigate the calendar faster with these keys.',
            )}
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {CALENDAR_SHORTCUTS.map((shortcut) => (
            <li key={shortcut.key} className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                {t(shortcut.labelKey, shortcut.fallback)}
              </span>
              <Kbd>{shortcut.key}</Kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
