'use client'

import { FileText } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type AppointmentNotesCellProps = {
  notes: string | null | undefined
  titleKey: string
  titleFallback: string
}

export function AppointmentNotesCell({
  notes,
  titleKey,
  titleFallback,
}: AppointmentNotesCellProps) {
  const t = useT()
  const empty = t('appointments.list.noValue')
  const trimmed = typeof notes === 'string' ? notes.trim() : ''

  if (!trimmed) {
    return <span className="text-sm text-muted-foreground">{empty}</span>
  }

  return (
    <div
      className="flex min-w-0 items-center gap-2"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="max-w-28 min-w-0 truncate text-sm" title={trimmed}>
        {trimmed}
      </div>
      <Popover modal>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            title={t('appointments.list.notes.viewFull', 'View full notes')}
            aria-label={t('appointments.list.notes.viewFull', 'View full notes')}
          >
            <FileText className="size-3.5" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 p-4"
          align="start"
          side="top"
          sideOffset={8}
          collisionPadding={16}
        >
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground">
              {t(titleKey, titleFallback)}
            </h4>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{trimmed}</p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
