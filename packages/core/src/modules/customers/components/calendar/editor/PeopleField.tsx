"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import type { EditorParticipant } from '../../../lib/calendar/editorPayload'
import { composeAccessibleName } from '../../../lib/calendar/labels'
import { searchPeopleOptions, type PersonOption } from './lookups'
import { PersonAvatarChip, UppercaseBadge } from './inputs'
import { EditorDropdown, type EditorDropdownGroup } from './EditorDropdown'

export function PeopleField({
  mode,
  placeholder,
  ariaLabel,
  value,
  onChange,
  includeCustomers,
  includeStaff = true,
}: {
  mode: 'multi' | 'single'
  placeholder: string
  ariaLabel: string
  value: EditorParticipant[]
  onChange(next: EditorParticipant[]): void
  includeCustomers: boolean
  /** Pass false when the staff module is not loaded — customer-only options. */
  includeStaff?: boolean
}) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [options, setOptions] = React.useState<PersonOption[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const results = await searchPeopleOptions(query.trim(), { includeCustomers, includeStaff, signal: controller.signal })
        if (cancelled) return
        setOptions(results)
      } catch {
        if (!cancelled) setOptions([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, query, includeCustomers, includeStaff])

  const selectedIds = new Set(value.map((participant) => participant.userId))
  const visibleOptions = options.filter((option) => !selectedIds.has(option.userId))

  const customerBadge = (
    <UppercaseBadge className="bg-status-info-bg text-status-info-text">
      {t('customers.calendar.editor.customerBadge', 'Customer')}
    </UppercaseBadge>
  )

  const groups = React.useMemo<EditorDropdownGroup[]>(() => [{
    options: visibleOptions.map((option) => ({
      value: option.userId,
      label: option.name,
      subtitle: option.email,
      ariaLabel: composeAccessibleName([
        option.name,
        option.email,
        option.isCustomer ? t('customers.calendar.editor.customerBadge', 'Customer') : null,
      ]),
      title: composeAccessibleName([option.name, option.email]),
      icon: <Avatar size="xs" label={option.name} />,
      trailing: option.isCustomer ? customerBadge : undefined,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }], [visibleOptions, t])

  const handleSelect = (userId: string) => {
    const option = visibleOptions.find((entry) => entry.userId === userId)
    if (!option) return
    const participant: EditorParticipant = {
      userId: option.userId,
      name: option.name,
      email: option.email ?? undefined,
      isCustomer: option.isCustomer,
    }
    onChange(mode === 'single' ? [participant] : [...value, participant])
    setQuery('')
    if (mode === 'single') setOpen(false)
  }

  const customerWord = t('customers.calendar.editor.customerBadge', 'Customer')

  return (
    // The search field and the selection are separate rows on purpose. They used
    // to share one box, so picking someone could rewrap the input onto a second
    // line and move the caret out from under the cursor mid-search. With the
    // chips below, the field never changes height and never moves.
    <div className="flex w-full flex-col gap-2">
      <EditorDropdown
        open={open}
        onOpenChange={setOpen}
        ariaLabel={ariaLabel}
        // The field IS the search box, so the panel holds only the results and
        // the caller keeps ownership of `open`.
        triggerMode="anchor"
        groups={groups}
        loading={loading}
        onSelect={handleSelect}
        trigger={
          <SearchInput
            value={query}
            onChange={(next) => {
              setQuery(next)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            aria-label={ariaLabel}
            role="combobox"
            aria-expanded={open}
          />
        }
      />
      {value.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {value.map((participant) => (
            <PersonAvatarChip
              key={participant.userId}
              name={participant.name}
              tone={participant.isCustomer ? 'customer' : 'staff'}
              title={composeAccessibleName([
                participant.name,
                participant.email,
                participant.isCustomer ? customerWord : null,
              ])}
              onRemove={() => onChange(value.filter((entry) => entry.userId !== participant.userId))}
              removeLabel={t('customers.calendar.editor.removePerson', 'Remove {name}', { name: participant.name })}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
