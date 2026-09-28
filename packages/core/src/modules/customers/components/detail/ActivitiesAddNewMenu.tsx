'use client'

import * as React from 'react'
import { ChevronDown, Plus, Phone, Mail, Users, CheckSquare } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { MENU_ROW_HOVER, MENU_ROW_SPACING } from '@open-mercato/ui/primitives/menu'
import { cn } from '@open-mercato/shared/lib/utils'

export type ActivityKind = 'meeting' | 'call' | 'task' | 'email'

interface ActivitiesAddNewMenuProps {
  onSelect: (kind: ActivityKind) => void
  disabled?: boolean
}

const MENU_ITEMS: ReadonlyArray<{ kind: ActivityKind; icon: React.ComponentType<{ className?: string }>; key: string; fallback: string }> = [
  { kind: 'meeting', icon: Users, key: 'customers.activities.add.meeting', fallback: 'New meeting' },
  { kind: 'call', icon: Phone, key: 'customers.activities.add.call', fallback: 'Log call' },
  { kind: 'task', icon: CheckSquare, key: 'customers.activities.add.task', fallback: 'New task' },
  { kind: 'email', icon: Mail, key: 'customers.activities.add.email', fallback: 'Compose email' },
]

export function ActivitiesAddNewMenu({ onSelect, disabled }: ActivitiesAddNewMenuProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  const handleSelect = React.useCallback(
    (kind: ActivityKind) => {
      setOpen(false)
      onSelect(kind)
    },
    [onSelect],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="soft"
          disabled={disabled}
          aria-label={t('customers.activities.addNew', 'Add new')}
        >
          <Plus className="size-4" />
          {t('customers.activities.addNew', 'Add new')}
          <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1.5">
        <ul className="flex flex-col">
          {MENU_ITEMS.map(({ kind, icon: Icon, key, fallback }) => (
            <li key={kind} className={MENU_ROW_SPACING}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleSelect(kind)}
                className={cn('h-auto w-full justify-start gap-2 rounded-md px-3 py-2 text-sm font-normal text-foreground', MENU_ROW_HOVER)}
              >
                <Icon className="size-4 text-muted-foreground" />
                {t(key, fallback)}
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export default ActivitiesAddNewMenu
