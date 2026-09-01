"use client"

import * as React from 'react'
import { Box, Check, ChevronDown, Plus } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import type { EditorResource } from '../../../lib/calendar/editorPayload'
import { fetchResourceTypes, searchResourceOptions, type ResourceOption, type ResourceType } from './lookups'
import { CONTROL_BOX, CONTROL_HEIGHT, CONTROL_MIN_HEIGHT } from './inputs'
import { EditorDropdown, type EditorDropdownGroup } from './EditorDropdown'

const TYPE_SEARCH_THRESHOLD = 8

// Multi-select of bookable resources (rooms, cars, equipment) from the
// resources module. Rendered only when that module is loaded — the calendar
// consumes its public list API and stores FK-id + label snapshots in
// `linkedEntities`, never resource entities (#3552). A potentially large
// catalog (many resources AND many types) stays navigable with a collapsible
// resource-type filter (searchable, with counts), server-side search and a
// "showing N of M" hint.
export function ResourcesField({
  placeholder,
  ariaLabel,
  value,
  onChange,
}: {
  placeholder: string
  ariaLabel: string
  value: EditorResource[]
  onChange(next: EditorResource[]): void
}) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [options, setOptions] = React.useState<ResourceOption[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [types, setTypes] = React.useState<ResourceType[]>([])
  const [typeFilter, setTypeFilter] = React.useState<string | null>(null)
  const [typeMenuOpen, setTypeMenuOpen] = React.useState(false)
  const [typeQuery, setTypeQuery] = React.useState('')
  const close = React.useCallback(() => {
    setOpen(false)
    setTypeMenuOpen(false)
  }, [])

  // Load the type filter once the dropdown first opens.
  React.useEffect(() => {
    if (!open || types.length > 0) return
    const controller = new AbortController()
    let cancelled = false
    fetchResourceTypes(controller.signal).then((found) => {
      if (!cancelled) setTypes(found)
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [open, types.length])

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const result = await searchResourceOptions({ query: query.trim(), resourceTypeId: typeFilter }, controller.signal)
        if (cancelled) return
        setOptions(result.items)
        setTotal(result.total)
      } catch {
        if (!cancelled) {
          setOptions([])
          setTotal(0)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, query, typeFilter])

  const selectedIds = new Set(value.map((resource) => resource.id))
  const visibleOptions = options.filter((option) => !selectedIds.has(option.id))
  const hiddenCount = Math.max(0, total - options.length)
  const activeType = typeFilter ? types.find((type) => type.id === typeFilter) ?? null : null
  const filteredTypes = typeQuery.trim().length
    ? types.filter((type) => type.name.toLowerCase().includes(typeQuery.trim().toLowerCase()))
    : types

  const selectType = (id: string | null) => {
    setTypeFilter(id)
    setTypeMenuOpen(false)
    setTypeQuery('')
  }

  // The type filter swaps the panel's list rather than opening a second popover
  // — one panel, two modes, which is what the nested markup was doing by hand.
  const groups = React.useMemo<EditorDropdownGroup[]>(() => {
    if (typeMenuOpen) {
      return [{
        options: [
          { value: 'type:__all__', label: t('customers.calendar.editor.resourceTypes.all', 'All types') },
          ...filteredTypes.map((type) => ({
            value: `type:${type.id}`,
            label: type.name,
            trailing: <span className="shrink-0 text-xs text-muted-foreground">{type.count}</span>,
          })),
        ],
      }]
    }
    return [{
      options: visibleOptions.map((option) => ({
        value: option.id,
        label: option.label,
        title: option.label,
        icon: <Box aria-hidden className="size-4 text-muted-foreground" />,
      })),
    }]
  }, [typeMenuOpen, filteredTypes, visibleOptions, t])

  const handleSelect = (next: string) => {
    if (next.startsWith('type:')) {
      selectType(next === 'type:__all__' ? null : next.slice('type:'.length))
      return
    }
    const option = visibleOptions.find((entry) => entry.id === next)
    if (!option) return
    onChange([...value, { id: option.id, label: option.label }])
    setQuery('')
  }

  const selectedValues = typeMenuOpen
    ? [typeFilter === null ? 'type:__all__' : `type:${typeFilter}`]
    : []

  return (
    <EditorDropdown
      open={open}
      onOpenChange={(next) => { setOpen(next); if (!next) setTypeMenuOpen(false) }}
      ariaLabel={typeMenuOpen ? t('customers.calendar.editor.resourceTypes.filterLabel', 'Resource type') : ariaLabel}
      triggerMode="anchor"
      groups={groups}
      loading={typeMenuOpen ? false : loading}
      selectedValues={selectedValues}
      onSelect={handleSelect}
      searchValue={typeMenuOpen && types.length > TYPE_SEARCH_THRESHOLD ? typeQuery : undefined}
      onSearchChange={typeMenuOpen && types.length > TYPE_SEARCH_THRESHOLD ? setTypeQuery : undefined}
      searchPlaceholder={t('customers.calendar.editor.resourceTypes.searchPlaceholder', 'Search types…')}
      headerSlot={types.length > 0 ? (
        <div className="border-b border-border p-1.5">
          <Button
            type="button"
            variant="outline"
            aria-haspopup="listbox"
            aria-expanded={typeMenuOpen}
            onClick={() => setTypeMenuOpen((previous) => !previous)}
            className={cn(CONTROL_HEIGHT, 'w-full justify-between px-2 text-sm font-normal shadow-none', CONTROL_BOX)}
          >
            <span className="truncate">
              {activeType
                ? `${activeType.name} (${activeType.count})`
                : t('customers.calendar.editor.resourceTypes.all', 'All types')}
            </span>
            <ChevronDown aria-hidden className="size-4 shrink-0 opacity-60" />
          </Button>
        </div>
      ) : undefined}
      trigger={
        <div
          className={cn(
            'flex w-full flex-wrap content-center items-center gap-2 px-2.5 py-1.5',
            CONTROL_MIN_HEIGHT,
            CONTROL_BOX,
          )}
        >
          {value.map((resource) => (
            <span key={resource.id} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted py-1 pl-2 pr-2">
              <Box aria-hidden className="size-3.5 text-muted-foreground" />
              <span className="max-w-40 truncate text-xs font-medium text-foreground">{resource.label}</span>
              <IconButton
                variant="ghost"
                size="xs"
                onClick={(event) => {
                  event.stopPropagation()
                  onChange(value.filter((entry) => entry.id !== resource.id))
                }}
                aria-label={t('customers.calendar.editor.removeResource', 'Remove {name}', { name: resource.label })}
                className="size-5 shrink-0"
              >
                <Plus aria-hidden className="size-3.5 rotate-45 opacity-50" />
              </IconButton>
            </span>
          ))}
          <Input
            type="text"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder={value.length > 0 ? '' : placeholder}
            aria-label={ariaLabel}
            role="combobox"
            aria-expanded={open}
            className="min-w-36 flex-1 border-0 bg-transparent px-0 shadow-none hover:bg-transparent focus-within:border-transparent focus-within:shadow-none"
            inputClassName="text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
      }
    />
  )
}

function TypeRow({ label, count, active, onSelect }: { label: string; count?: number; active: boolean; onSelect(): void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={cn('h-auto w-full justify-start gap-2 px-2 py-1.5 text-left text-sm font-normal', active ? 'bg-muted text-foreground' : 'text-foreground')}
    >
      <Check aria-hidden className={cn('size-4 shrink-0', active ? 'opacity-100' : 'opacity-0')} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === 'number' ? <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{count}</span> : null}
    </Button>
  )
}
