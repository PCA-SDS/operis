"use client"

import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { QuickAddComposer } from './QuickAddComposer'

/**
 * Quick Add raised over whatever page the user was on, in the shared dialog
 * chrome: title, close button and insets are every other dialog's, and the
 * composer renders `embedded` so it is part of the panel rather than a card
 * floating inside it.
 *
 * Anchored near the top rather than centred: the composer grows downward as
 * the description and mention menu open, and a centred dialog would move by
 * half of every pixel it grew. The body's bottom inset is the dialog's 20/24px
 * less the 10px the composer's 56px footer band already leaves under its
 * buttons, so the buttons land where every dialog footer's do.
 */
export function QuickAddDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        size="lg"
        className="top-16 translate-y-0"
        closeAriaLabel={t('tasks.common.cancel', 'Cancel')}
      >
        <DialogHeader>
          <DialogTitle>{t('tasks.quickAdd.title', 'Add task')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex min-h-0 flex-col pb-2.5 sm:pb-3.5">
          <QuickAddComposer embedded onClose={onClose} onCreated={onClose} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
