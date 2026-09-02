"use client"

import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { menuRowStateClass } from '@open-mercato/ui/primitives/menu'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { CONTROL_HEIGHT, useCloseOnEditorScroll } from './inputs'

export type EditorDropdownOption = {
  value: string
  label: string
  subtitle?: string | null
  /** Leading glyph or avatar. */
  icon?: React.ReactNode
  /** Trailing adornment — a kind label, a STAFF/CUSTOMER badge, a deal chip. */
  trailing?: React.ReactNode
  /** Accessible name when the visible label alone is ambiguous. */
  ariaLabel?: string
  title?: string
}

export type EditorDropdownGroup = {
  /** Section heading. Omit for an ungrouped list. */
  label?: string
  options: EditorDropdownOption[]
}

export type EditorDropdownProps = {
  open: boolean
  onOpenChange(open: boolean): void
  ariaLabel: string
  /** The closed control. Callers own it because each field shows its selection
   *  differently — a chip row, a single chip, a value with a badge. */
  trigger: React.ReactNode
  /**
   * How the trigger opens the list.
   *
   * `button` (default) lets Radix toggle on click. `anchor` only positions the
   * panel and leaves `open` to the caller — needed by the chip pickers, whose
   * trigger contains a live text input: a `PopoverTrigger` would swallow that
   * input's clicks and toggle the panel shut on every keystroke.
   */
  triggerMode?: 'button' | 'anchor'
  groups: EditorDropdownGroup[]
  onSelect(value: string): void
  /** Values that render a checkmark. One entry for a single-select field, many
   *  for a multi-select one — the list itself does not care which it is. */
  selectedValues?: string[]
  searchValue?: string
  onSearchChange?(next: string): void
  searchPlaceholder?: string
  /** Rendered above the search box — the Resources type filter lives here. */
  headerSlot?: React.ReactNode
  loading?: boolean
  emptyLabel?: string
}

/**
 * The one dropdown for the calendar editor's pickers.
 *
 * The three fields that need it — related record, people, resources — each grew
 * their own copy of the same popover: a panel positioned with `absolute`, a
 * document-level `pointerdown` listener to close it, a search box, a loading
 * line, an empty line, and a list of rows. Same behaviour, three
 * implementations, and only the row contents genuinely differed.
 *
 * The DS has no compact async-search dropdown that carries icons and badges —
 * `ComboboxInput` and `TagsInput` are text-only, `LookupSelect` renders a
 * always-open list of `p-4` cards for detail pages, and `Select` is for fixed
 * option sets. So this composes the DS `Popover`, which is the part that was
 * being re-implemented badly: it portals to `z-popover` (above the dialog) and
 * Radix owns outside-click and Escape, so the hand-rolled dismissal listener is
 * gone. What remains here is only the list, which is the part that is actually
 * specific to this form.
 *
 * The trigger stays with the caller, matching the reference's own composition
 * (`CreateUserDialog` pairs `ERPDropdown` with a chip row it renders itself).
 */
export function EditorDropdown({
  open,
  onOpenChange,
  ariaLabel,
  trigger,
  triggerMode = 'button',
  groups,
  onSelect,
  selectedValues,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  headerSlot,
  loading = false,
  emptyLabel,
}: EditorDropdownProps) {
  const t = useT()
  const anchorRef = React.useRef<HTMLDivElement | null>(null)
  useCloseOnEditorScroll(onOpenChange)
  const selected = React.useMemo(() => new Set(selectedValues ?? []), [selectedValues])
  const isEmpty = groups.every((group) => group.options.length === 0)

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {triggerMode === 'anchor' ? (
        // NOT `asChild`. The chip pickers' trigger is a `SearchInput`, which
        // forwards its ref to the inner `<input>` — so `asChild` anchored the
        // panel to the element between the magnifier and the clear button
        // instead of to the field. The panel came out narrower than the field,
        // shifted right by the width of the glyph, and — because the input is
        // vertically centred in the 36px box — overlapping the field's own
        // bottom edge. Anchoring to a wrapper the picker owns measures the
        // whole control.
        <PopoverAnchor ref={anchorRef} className="w-full">
          {trigger}
        </PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      )}
      <PopoverContent
        align="start"
        // Match the field it belongs to rather than the popover default, so the
        // list reads as that control opening rather than as a floating panel.
        // The arbitrary value is deliberate and unavoidable: the width is the
        // trigger's, which Radix publishes as a CSS variable at run time and no
        // spacing-scale token can express. `min-w-0` clears the primitive's own
        // 280px floor, which would otherwise overhang a narrower field.
        className="w-[var(--radix-popover-trigger-width)] min-w-0 p-1"
        onOpenAutoFocus={(event) => {
          // Focus the search box when there is one; otherwise let the first row
          // take focus as Radix intends. In anchor mode the caller's own input
          // already holds focus and must keep it.
          if (onSearchChange || triggerMode === 'anchor') event.preventDefault()
        }}
        // Radix counts a `PopoverTrigger` as part of the popover but an anchor
        // as outside it, so clicking the search field the panel belongs to
        // dismissed it — and the field's own focus handler opened it straight
        // back up. That round trip is the flicker. Treat presses on the anchor
        // as inside and let the caller decide what they mean.
        onPointerDownOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault()
        }}
        onFocusOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault()
        }}
      >
        {headerSlot}
        {onSearchChange ? (
          <Input
            type="text"
            value={searchValue ?? ''}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder ?? ariaLabel}
            autoFocus
            className="mb-1"
          />
        ) : null}
        <div role="listbox" aria-label={ariaLabel} className="max-h-56 space-y-1 overflow-y-auto">
          {/* Rows stay put while the next search is in flight. Swapping the
              whole list out for a "Searching…" line meant the panel emptied and
              refilled on every keystroke, which reads as flicker; the hint is
              only worth showing when there is nothing underneath it yet. */}
          {loading && isEmpty ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t('customers.calendar.editor.searching', 'Searching…')}
            </p>
          ) : null}
          {!loading && isEmpty ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {emptyLabel ?? t('customers.calendar.editor.noResults', 'No results')}
            </p>
          ) : null}
          {groups.map((group, groupIndex) => (
            <React.Fragment key={group.label ?? `group-${groupIndex}`}>
              {group.label && group.options.length > 0 ? (
                <p className="px-2 pb-1 pt-2 text-overline font-medium uppercase text-muted-foreground">
                  {group.label}
                </p>
              ) : null}
              {group.options.map((option) => {
                const active = selected.has(option.value)
                return (
                  <Button
                    key={`${group.label ?? ''}:${option.value}`}
                    type="button"
                    variant="ghost"
                    role="option"
                    aria-selected={active}
                    aria-label={option.ariaLabel}
                    title={option.title}
                    onClick={() => onSelect(option.value)}
                    className={cn(
                      'h-auto w-full justify-start gap-2 whitespace-normal px-2 py-1.5 text-left text-sm font-normal text-foreground',
                      menuRowStateClass({ selected: active }),
                    )}
                  >
                    {option.icon}
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                      {option.subtitle ? (
                        <span className="ml-1.5 text-xs text-muted-foreground">{option.subtitle}</span>
                      ) : null}
                    </span>
                    {option.trailing}
                    <Check
                      aria-hidden
                      className={cn('size-4 shrink-0', active ? 'opacity-100' : 'opacity-0')}
                    />
                  </Button>
                )
              })}
            </React.Fragment>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** The closed control shared by the chip pickers: a filled, borderless box that
 *  starts at the common control height and grows as chips wrap. */
export const EDITOR_TRIGGER_ROW = cn(
  CONTROL_HEIGHT,
  'flex w-full items-center gap-2 px-2.5 text-left transition-colors hover:bg-surface-strong',
)
