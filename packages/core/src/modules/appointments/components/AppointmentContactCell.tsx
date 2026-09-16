'use client'

import { Mail, Phone, User } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatCustomerPhone } from '../lib/phoneSnapshot'

type AppointmentContactCellProps = {
  phoneCountryCode?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
}

export function AppointmentContactCell({
  phoneCountryCode,
  customerPhone,
  customerEmail,
}: AppointmentContactCellProps) {
  const t = useT()
  const empty = t('appointments.list.noValue')
  const phone = formatCustomerPhone(phoneCountryCode, customerPhone)
  const email = typeof customerEmail === 'string' ? customerEmail.trim() : ''
  const phoneLabel = phone || empty
  const emailLabel = email || empty

  return (
    <div
      className="flex min-w-0 items-center gap-2"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span className="min-w-0 flex-1 truncate text-sm">{phoneLabel}</span>
      <Popover modal>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            title={t('appointments.list.contact.viewDetails', 'View contact details')}
            aria-label={t('appointments.list.contact.viewDetails', 'View contact details')}
          >
            <User className="size-3.5" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto p-4"
          align="end"
          side="top"
          sideOffset={8}
          collisionPadding={16}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Phone className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm font-medium">{phoneLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm font-medium">{emailLabel}</span>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
