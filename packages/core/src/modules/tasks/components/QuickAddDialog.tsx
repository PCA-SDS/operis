"use client"

import { Dialog, DialogContent, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { QuickAddComposer } from './QuickAddComposer'

/**
 * Quick Add raised over whatever page the user was on. Anchored near the top
 * rather than centred: the composer grows downward as the description and
 * mention menu open, and a centred dialog would jump as it did.
 */
export function QuickAddDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        disableBodyWrap
        dismissible={false}
        className="top-16 max-w-xl translate-y-0 gap-0 border-0 bg-transparent p-0 shadow-none"
      >
        <DialogTitle className="sr-only">{t('tasks.quickAdd.title', 'Add task')}</DialogTitle>
        <QuickAddComposer floating onClose={onClose} onCreated={onClose} />
      </DialogContent>
    </Dialog>
  )
}
