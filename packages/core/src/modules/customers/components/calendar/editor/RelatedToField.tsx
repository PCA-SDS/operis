"use client"

import * as React from 'react'
import { Building2, ChevronDown, User, X } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { EditorRelatedTo } from '../../../lib/calendar/editorPayload'
import { composeAccessibleName } from '../../../lib/calendar/labels'
import {
  fetchDealsForEntity,
  searchRelatedEntities,
  type DealOption,
  type RelatedEntityOption,
} from './lookups'
import { CONTROL_BOX, CONTROL_HEIGHT, PersonChip, UppercaseBadge } from './inputs'
import { EditorDropdown, type EditorDropdownGroup } from './EditorDropdown'

/** Deal ids share a namespace with entity ids, so the two lists are told apart
 *  by prefix rather than by which group the row came from. */
const DEAL_PREFIX = 'deal:'
const NO_DEAL_VALUE = 'deal:__none__'

export function RelatedToField({
  label,
  value,
  deal,
  onChange,
  onDealChange,
  error,
}: {
  label: string
  value: EditorRelatedTo | null
  deal: DealOption | null
  onChange(next: EditorRelatedTo | null): void
  onDealChange(next: DealOption | null): void
  error?: string | null
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [options, setOptions] = React.useState<RelatedEntityOption[]>([])
  const [deals, setDeals] = React.useState<DealOption[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const trimmed = query.trim()
        const [people, companies] = await Promise.all([
          searchRelatedEntities('person', trimmed, controller.signal),
          searchRelatedEntities('company', trimmed, controller.signal),
        ])
        if (cancelled) return
        setOptions([...people, ...companies])
      } catch {
        if (!cancelled) setOptions([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, query])

  React.useEffect(() => {
    if (!open || !value || value.kind === 'unknown') {
      setDeals([])
      return
    }
    const controller = new AbortController()
    let cancelled = false
    fetchDealsForEntity({ id: value.id, kind: value.kind }, controller.signal)
      .then((items) => { if (!cancelled) setDeals(items) })
      .catch(() => { if (!cancelled) setDeals([]) })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [open, value])

  const kindLabel = (kind: RelatedEntityOption['kind']) =>
    kind === 'person'
      ? t('customers.deals.detail.tabs.peopleSingular', 'Person')
      : t('customers.deals.detail.tabs.companySingular', 'Company')

  const placeholder = t('customers.calendar.editor.relatedToPlaceholder', 'Search people or companies…')

  const groups = React.useMemo<EditorDropdownGroup[]>(() => {
    const entityGroup: EditorDropdownGroup = {
      options: options.map((option) => ({
        value: option.id,
        label: option.label,
        subtitle: option.subtitle,
        ariaLabel: composeAccessibleName([option.label, option.subtitle, kindLabel(option.kind)]),
        title: composeAccessibleName([option.label, option.subtitle]),
        icon: option.kind === 'company'
          ? <Building2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          : <User aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />,
        trailing: <span className="shrink-0 text-xs text-muted-foreground">{kindLabel(option.kind)}</span>,
      })),
    }
    if (!value || deals.length === 0) return [entityGroup]
    return [
      entityGroup,
      {
        label: t('customers.calendar.editor.dealsSection', 'Deals'),
        options: [
          { value: NO_DEAL_VALUE, label: t('customers.calendar.editor.dealNone', 'No deal') },
          ...deals.map((option) => ({
            value: `${DEAL_PREFIX}${option.id}`,
            label: option.label,
            title: option.label,
            trailing: (
              <UppercaseBadge className="bg-status-info-bg text-status-info-text">
                {t('customers.calendar.editor.dealBadgeSuffix', 'Deal')}
              </UppercaseBadge>
            ),
          })),
        ],
      },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, deals, value, t])

  const handleSelect = (next: string) => {
    if (next === NO_DEAL_VALUE) {
      onDealChange(null)
      setOpen(false)
      return
    }
    if (next.startsWith(DEAL_PREFIX)) {
      const picked = deals.find((entry) => `${DEAL_PREFIX}${entry.id}` === next)
      if (picked) onDealChange(picked)
      setOpen(false)
      return
    }
    const picked = options.find((entry) => entry.id === next)
    if (!picked) return
    onChange({ id: picked.id, kind: picked.kind, label: picked.label })
    // A different entity invalidates whatever deal was chosen under the old one.
    if (value?.id !== picked.id) onDealChange(null)
    setQuery('')
  }

  const selectedValues = [
    ...(value ? [value.id] : []),
    ...(deal ? [`${DEAL_PREFIX}${deal.id}`] : value ? [NO_DEAL_VALUE] : []),
  ]

  return (
    <div className="relative w-full">
      <div
        className={cn(
          CONTROL_HEIGHT,
          'flex w-full items-center pl-2.5 pr-3 transition-colors hover:bg-surface-strong',
          CONTROL_BOX,
          // The invalid edge is the one place a border comes back — it has to
          // out-signal the fill, which is why it overrides `CONTROL_BOX` here.
          error ? 'border-status-error-border' : '',
        )}
      >
        <EditorDropdown
          open={open}
          onOpenChange={setOpen}
          ariaLabel={label}
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder={placeholder}
          loading={loading}
          groups={groups}
          selectedValues={selectedValues}
          onSelect={handleSelect}
          trigger={
            <button
              type="button"
              aria-label={label}
              className="flex h-full min-w-0 flex-1 items-center justify-between gap-2 bg-transparent p-0 text-left outline-none focus-visible:shadow-focus"
            >
              <span className="flex min-w-0 items-center gap-2">
                {value ? (
                  <PersonChip compact name={value.label || value.id} />
                ) : (
                  <span className="truncate text-sm text-muted-foreground">{placeholder}</span>
                )}
              </span>
              <span className="flex shrink-0 items-center">
                {deal ? (
                  <UppercaseBadge className="h-7 bg-status-info-bg text-status-info-text">
                    {t('customers.calendar.editor.dealBadge', '{name} · Deal', { name: deal.label })}
                  </UppercaseBadge>
                ) : null}
                <span aria-hidden className="h-px w-2" />
                <ChevronDown aria-hidden className="size-4 opacity-60" />
              </span>
            </button>
          }
        />
        {value ? (
          <IconButton
            variant="ghost"
            size="xs"
            onClick={() => {
              onChange(null)
              onDealChange(null)
            }}
            aria-label={t('customers.calendar.editor.removeRelated', 'Clear related record')}
            className="ms-1 shrink-0 text-muted-foreground"
          >
            <X aria-hidden className="size-3.5" />
          </IconButton>
        ) : null}
      </div>
    </div>
  )
}
