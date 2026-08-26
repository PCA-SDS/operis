"use client"

import * as React from 'react'
import { Check, Plus, Tag, Trash2 } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { MENU_ROW_HOVER, menuRowStateClass, MENU_ROW_SPACING } from '@open-mercato/ui/primitives/menu'
import type { LabelDto } from '../data/types'
import { CHIP_ADD_CLASS } from './badges'
import { useLabelMutations, useLabels } from './hooks'

/** Colours a new label cycles through, so a catalog built by clicking "create"
 *  still comes out varied. Values are the DS status/chart hues. */
export const LABEL_PALETTE = [
  '#C0483F',
  '#B45309',
  '#A16207',
  '#2F855A',
  '#0E7490',
  '#3F7BC0',
  '#7C5CD6',
  '#B4308A',
  '#64748B',
] as const

/**
 * Picks labels for a task and doubles as the catalog editor — typing a name
 * that does not exist offers to create it, which is where nearly every label in
 * practice comes from.
 */
export function TaskLabelPicker({
  value,
  onChange,
  dense = false,
}: {
  value: string[]
  onChange: (labelIds: string[]) => void
  dense?: boolean
}) {
  const t = useT()
  const { labels } = useLabels()
  const { create, remove } = useLabelMutations()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')

  const selected = React.useMemo(() => new Set(value), [value])
  const needle = query.trim().toLowerCase()
  const filtered = labels.filter((label) => label.name.toLowerCase().includes(needle))
  const exact = labels.some((label) => label.name.toLowerCase() === needle)

  const toggle = (id: string) => {
    onChange(selected.has(id) ? value.filter((entry) => entry !== id) : [...value, id])
  }

  const createLabel = async () => {
    const name = query.trim()
    if (name === '') return
    try {
      const color = LABEL_PALETTE[labels.length % LABEL_PALETTE.length]
      const label = await create.mutateAsync({ name, color })
      onChange([...value, label.id])
      setQuery('')
    } catch {
      flash(t('tasks.labels.createFailed', 'Could not create the label.'), 'error')
    }
  }

  const triggerLabel = dense
    ? value.length > 0
      ? t('tasks.labels.addShort', 'Add')
      : t('tasks.labels.add', 'Add labels')
    : value.length > 0
      ? t('tasks.labels.count', '{count} labels', { count: value.length })
      : t('tasks.labels.add', 'Add labels')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            dense
              ? CHIP_ADD_CLASS
              : 'inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:shadow-focus'
          }
        >
          {dense ? (
            <Plus className="size-3.5" aria-hidden="true" />
          ) : (
            <Tag className="size-3.5" aria-hidden="true" />
          )}
          {triggerLabel}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="flex max-h-72 w-64 flex-col p-2"
        role="listbox"
        aria-label={t('tasks.labels.menuLabel', 'Task labels')}
      >
        <div className="mb-1 pb-1">
          <SearchInput
            value={query}
            onChange={setQuery}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !exact && needle !== '') {
                event.preventDefault()
                void createLabel()
              }
            }}
            placeholder={t('tasks.labels.filterOrCreate', 'Filter or create…')}
            aria-label={t('tasks.labels.filterOrCreateLabel', 'Filter or create a label')}
            size="sm"
            autoFocus
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {filtered.map((label) => (
            <LabelRow
              key={label.id}
              label={label}
              checked={selected.has(label.id)}
              onToggle={() => toggle(label.id)}
              onDelete={() => {
                remove.mutate(
                  { id: label.id, updatedAt: label.updatedAt },
                  {
                    onError: () => flash(t('tasks.labels.deleteFailed', 'Could not delete.'), 'error'),
                  },
                )
              }}
            />
          ))}

          {needle !== '' && !exact && (
            <button
              type="button"
              onClick={() => void createLabel()}
              disabled={create.isPending}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-accent-strong transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:text-disabled-foreground"
            >
              <Plus className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="flex-1 truncate text-left">
                {t('tasks.labels.create', 'Create “{name}”', { name: query.trim() })}
              </span>
            </button>
          )}

          {labels.length === 0 && needle === '' && (
            <div className="px-2">
              <EmptyState
                variant="subtle"
                size="sm"
                title={t('tasks.labels.empty', 'No labels yet')}
                description={t('tasks.labels.emptyHint', 'Type a name in the box above to create your first one.')}
              />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function LabelRow({
  label,
  checked,
  onToggle,
  onDelete,
}: {
  label: LabelDto
  checked: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const t = useT()
  return (
    <div
      className={cn(
        MENU_ROW_SPACING,
        'group flex items-center gap-2 rounded-md pr-1 text-sm transition-colors',
        menuRowStateClass({ selected: checked }),
        !checked && MENU_ROW_HOVER,
      )}
    >
      <button
        type="button"
        role="option"
        aria-selected={checked}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left font-medium text-foreground"
      >
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: label.color }}
        />
        <span className="flex-1 truncate">{label.name}</span>
        {checked && <Check className="size-3.5 shrink-0 text-accent-strong" aria-hidden="true" />}
      </button>
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t('tasks.labels.deleteLabel', 'Delete label {name}', { name: label.name })}
        onClick={onDelete}
        className="text-destructive opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </IconButton>
    </div>
  )
}
