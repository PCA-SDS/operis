"use client"

import * as React from 'react'
import { Search, Users } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Input } from '@open-mercato/ui/primitives/input'
import { SelectionIndicator } from '@open-mercato/ui/primitives/selection-indicator'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ChatDirectoryEntryDto } from '../data/types'
import { useDirectorySearch } from './hooks'

/** Long enough that a typist does not fire a request per keystroke, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 250

export type MemberPickerProps = {
  /** The people chosen so far, owned by the parent so it can submit them. */
  selected: ChatDirectoryEntryDto[]
  onChange: (next: ChatDirectoryEntryDto[]) => void
  /** Ids to hide from the results — people already in the space being edited. */
  excludeIds?: readonly string[]
  /** Off while the containing dialog is closed, so nothing is fetched. */
  enabled: boolean
  disabled?: boolean
  autoFocus?: boolean
  /** Cap enforced by the API; the picker stops adding rather than letting a request fail. */
  max: number
}

function PickerSkeleton() {
  return (
    <div className="space-y-1" aria-busy="true">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton shape="circle" className="size-9" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Choose colleagues from the organization directory.
 *
 * The one picker both flows use — creating a space and adding to an existing one
 * — so "who may I add" is answered in a single place, and it is the *same*
 * `/api/chat/directory` endpoint the direct-message search already uses. That
 * endpoint takes its scope from the session, so there is no request this
 * component could make that reaches another organization: the exclusion below is
 * a convenience, never the boundary.
 *
 * Selection survives the search term changing — the chips are the state, the
 * result list is just a view over the directory — so someone can add three
 * people found by three different queries without losing the first two.
 */
export function MemberPicker({
  selected,
  onChange,
  excludeIds,
  enabled,
  disabled,
  autoFocus,
  max,
}: MemberPickerProps) {
  const t = useT()
  const [term, setTerm] = React.useState('')
  const [debounced, setDebounced] = React.useState('')

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term])

  // Reset when the picker is put away, so reopening it does not show the
  // previous search.
  React.useEffect(() => {
    if (enabled) return
    setTerm('')
    setDebounced('')
  }, [enabled])

  const { people, truncated, isLoading, error, retry } = useDirectorySearch(debounced, enabled)

  const excluded = React.useMemo(() => new Set(excludeIds ?? []), [excludeIds])
  const selectedIds = React.useMemo(() => new Set(selected.map((person) => person.id)), [selected])
  const visible = React.useMemo(
    () => people.filter((person) => !excluded.has(person.id)),
    [excluded, people],
  )

  const atCapacity = selected.length >= max

  const toggle = React.useCallback(
    (person: ChatDirectoryEntryDto) => {
      if (selectedIds.has(person.id)) {
        onChange(selected.filter((entry) => entry.id !== person.id))
        return
      }
      // Refuse silently rather than sending a request the server will reject:
      // the counter below already says how many are left.
      if (selected.length >= max) return
      onChange([...selected, person])
    },
    [max, onChange, selected, selectedIds],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/*
        A form `Input` with a leading glyph, not the toolbar `SearchInput`.

        `SearchInput`'s default tone is `bg-surface-muted` and borderless — the
        filter-bar grammar, which is right on a page ground and wrong directly
        under a bordered `Input` in the same dialog. Stacking the two put two
        different kinds of field in one form. This is the same construction the
        product's other picker dialog uses.
      */}
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={term}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(event) => setTerm(event.target.value)}
          aria-label={t('chat.members.searchLabel', 'Search colleagues')}
          placeholder={t('chat.start.searchPlaceholder', 'Name, email or role…')}
          className="pl-9"
        />
      </div>

      {/* The chosen people, removable in place. Rendered above the results so
          the answer to "who have I picked?" does not require scrolling a list
          that changes under every keystroke — and under the product's uppercase
          eyebrow, so it reads as a labelled group instead of chips adrift
          between two controls. */}
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-overline font-semibold uppercase tracking-widest text-muted-foreground">
            {t('chat.members.selected', '{count} selected', { count: selected.length })}
          </span>
          {selected.map((person) => (
            <Tag
              key={person.id}
              variant="info"
              disabled={disabled}
              onRemove={() => onChange(selected.filter((entry) => entry.id !== person.id))}
              removeAriaLabel={t('chat.members.remove', 'Remove {name}', { name: person.name })}
            >
              {person.name}
            </Tag>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <PickerSkeleton />
        ) : error ? (
          <ErrorMessage
            label={t('chat.start.searchError', "Couldn't search your organization")}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => retry()}>
                {t('chat.actions.retry', 'Try again')}
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            variant="subtle"
            size="sm"
            icon={<Users className="size-5" aria-hidden="true" />}
            title={
              debounced
                ? t('chat.start.noMatchTitle', 'Nobody matches that')
                : t('chat.members.noneAvailableTitle', 'Nobody left to add')
            }
            description={
              debounced
                ? t('chat.start.noMatchDescription', 'No active member of your organization matches “{query}”.', {
                    query: debounced,
                  })
                : t(
                    'chat.members.noneAvailableDescription',
                    'Everyone in your organization is already here.',
                  )
            }
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {visible.map((person) => {
              const checked = selectedIds.has(person.id)
              const isDisabled = Boolean(disabled) || (!checked && atCapacity)
              return (
                <li key={person.id}>
                  {/*
                    The whole row is the control, and the mark beside it is
                    decoration — which is what makes this both valid and
                    accessible.

                    Putting the DS `Checkbox` in here instead would nest a
                    `<button>` inside a `<button>`: invalid HTML and a React
                    hydration error, because Radix renders the checkbox as a
                    real button. The product's other picker avoids that with a
                    `<div role="button">`, which trades the nesting for a
                    non-button that has to reimplement Enter and Space. A real
                    `<button>` carrying `role="checkbox"`, with the indicator
                    marked `aria-hidden`, needs neither compromise.
                  */}
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    disabled={isDisabled}
                    onClick={() => toggle(person)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                      'outline-none focus-visible:shadow-focus',
                      checked
                        ? 'border-border bg-surface-muted'
                        : 'border-transparent hover:bg-surface-muted',
                      isDisabled && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <Avatar label={person.name} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {person.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {person.roleNames.length > 0
                          ? `${person.email} — ${person.roleNames.join(', ')}`
                          : person.email}
                      </span>
                    </span>
                    <SelectionIndicator checked={checked} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {truncated ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {t('chat.start.truncated', 'Showing the closest matches. Keep typing to narrow them down.')}
          </p>
        ) : null}
      </div>

      {/* Only once it matters. A limit nobody is near is noise. */}
      {atCapacity ? (
        <p className="text-xs text-muted-foreground">
          {t('chat.members.limitReached', 'You can add up to {count} people at a time.', { count: max })}
        </p>
      ) : null}
    </div>
  )
}
