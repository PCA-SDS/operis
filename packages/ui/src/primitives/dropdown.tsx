"use client"

import * as React from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, ChevronDown, Filter, Plus, Search, X } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Spinner } from './spinner'

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type DropdownOption<T> = {
  value: T
  /** Primary row text, also what the trigger renders when selected. */
  label: string
  /** Optional second line, rendered muted under the label. */
  description?: string
  /** Leading visual — icon, avatar, colour swatch, flag. */
  leading?: React.ReactNode
  /** Trailing visual rendered before the selected check. */
  trailing?: React.ReactNode
  disabled?: boolean
  /** Extra terms matched by the in-menu search on top of `label`. */
  keywords?: string[]
}

export type DropdownGroup<T> = {
  label: string
  /** Second line under the group heading — what this group of rows is for. */
  description?: string
  options: DropdownOption<T>[]
}

/** A command row (not a selectable value) — "Manage tags", "Add filter". */
export type DropdownAction = {
  id?: string
  label: string
  leading?: React.ReactNode
  /** Omit when `href` is set — the row renders as a link instead. */
  onSelect?: () => void
  /** Renders the row as an anchor, so middle-click and "open in new tab" work. */
  href?: string
  disabled?: boolean
  /** Paints the row in `destructive` ink. Delete, revoke, discard. */
  destructive?: boolean
}

export type DropdownAlign = 'start' | 'center' | 'end'
export type DropdownSide = 'bottom' | 'top'

/* ------------------------------------------------------------------ *
 * Layout constants
 * ------------------------------------------------------------------ */

/** Gap the menu keeps from every viewport edge. */
const VIEWPORT_PADDING = 8
/** Gap between the trigger and the menu. */
const SIDE_OFFSET = 8
/** The menu never collapses below this, even in a cramped viewport — it
 *  scrolls internally instead, so a dropdown near the fold stays usable. */
const MIN_MENU_HEIGHT = 160
/** Default cap on the scrollable option list (PCA's `max-h-72`). */
const DEFAULT_MAX_LIST_HEIGHT = 288
/** Ghost labels reserve the trigger's width; cap how many we render so a
 *  thousand-option list does not put a thousand spans in the DOM. */
const MAX_MEASURED_LABELS = 20

/* ------------------------------------------------------------------ *
 * Trigger chrome
 * ------------------------------------------------------------------ */

const dropdownTriggerVariants = cva(
  'inline-flex items-center gap-2 font-medium transition-colors outline-none focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        /* Filter-bar chrome — the PCA default. Reads as a control, not a
           field: surface fill, neutral border, accent once a value is set. */
        filter:
          'rounded-lg border bg-surface focus-visible:ring-2 focus-visible:ring-focus-ring/30',
        /* Form-field chrome — matches `Input`/`SelectTrigger` so a dropdown
           sits flush in a `CrudForm` next to text inputs. */
        field:
          'w-full justify-between rounded-lg border border-input bg-input-bg hover:bg-modal-muted focus-visible:shadow-focus focus-visible:border-input-border-focus disabled:bg-input-disabled-bg disabled:border-border-disabled',
        /* Borderless — for dense table cells and inline editors. */
        ghost:
          'rounded-lg border border-transparent bg-transparent hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-focus-ring/30',
      },
      size: {
        xs: 'h-7 rounded-md px-2 text-xs',
        sm: 'h-8 rounded-md px-2.5 text-xs',
        default: 'h-9 px-3 text-sm',
        lg: 'h-10 px-3.5 text-sm',
      },
    },
    defaultVariants: { variant: 'filter', size: 'default' },
  },
)

export type DropdownTriggerVariants = VariantProps<typeof dropdownTriggerVariants>

/* ------------------------------------------------------------------ *
 * Anchored positioning
 * ------------------------------------------------------------------ */

type MenuPosition = {
  top: number
  left: number
  minWidth: number
  width?: number
  maxHeight: number
  side: DropdownSide
  /** The anchor has been scrolled out of its clipping ancestor — the menu
   *  hides rather than floating detached over unrelated content. */
  anchorHidden: boolean
}

/** Sub-pixel jitter from fractional rects must not count as movement. */
function samePosition(a: MenuPosition, b: MenuPosition): boolean {
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.minWidth - b.minWidth) < 0.5 &&
    Math.abs((a.width ?? 0) - (b.width ?? 0)) < 0.5 &&
    Math.abs(a.maxHeight - b.maxHeight) < 0.5 &&
    a.side === b.side &&
    a.anchorHidden === b.anchorHidden
  )
}

type UseAnchoredMenuArgs = {
  open: boolean
  triggerRef: React.RefObject<HTMLElement | null>
  menuRef: React.RefObject<HTMLElement | null>
  listRef: React.RefObject<HTMLElement | null>
  align: DropdownAlign
  matchTriggerWidth: boolean
  maxListHeight: number
}

/**
 * Viewport-anchored placement for a portalled menu — flip, shift, size, hide.
 *
 * The menu is `position: fixed` against the viewport, so no `overflow: hidden`
 * or `transform` on an ancestor can clip it and no ancestor's stacking context
 * can bury it. It flips above the trigger when the space below cannot hold it,
 * shifts horizontally to stay inside the viewport, and shrinks its own max
 * height (scrolling internally) rather than running off-screen.
 *
 * Unlike a close-on-scroll dropdown, this one *tracks* its anchor: scrolling
 * repositions the menu and only hides it once the trigger itself leaves view.
 */
function useAnchoredMenu({
  open,
  triggerRef,
  menuRef,
  listRef,
  align,
  matchTriggerWidth,
  maxListHeight,
}: UseAnchoredMenuArgs): MenuPosition | null {
  const [position, setPosition] = React.useState<MenuPosition | null>(null)
  const frameRef = React.useRef<number | null>(null)

  const measure = React.useCallback(() => {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return

    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    // Natural height, independent of any cap already applied: the chrome
    // (search field, footer, padding, borders) plus the list's full content.
    const list = listRef.current
    const chrome = list ? menu.offsetHeight - list.clientHeight : menu.offsetHeight
    const listContent = list ? Math.min(list.scrollHeight, maxListHeight) : 0
    const naturalHeight = chrome + listContent

    const menuWidth = Math.max(menu.offsetWidth, matchTriggerWidth ? rect.width : 0)

    const spaceBelow = viewportHeight - rect.bottom - SIDE_OFFSET - VIEWPORT_PADDING
    const spaceAbove = rect.top - SIDE_OFFSET - VIEWPORT_PADDING

    let side: DropdownSide
    if (naturalHeight <= spaceBelow) side = 'bottom'
    else if (naturalHeight <= spaceAbove) side = 'top'
    else side = spaceAbove > spaceBelow ? 'top' : 'bottom'

    const available = side === 'bottom' ? spaceBelow : spaceAbove
    const maxHeight = Math.max(Math.min(naturalHeight, available), MIN_MENU_HEIGHT)
    const renderedHeight = Math.min(naturalHeight, maxHeight)

    const top =
      side === 'bottom'
        ? Math.min(rect.bottom + SIDE_OFFSET, viewportHeight - VIEWPORT_PADDING - renderedHeight)
        : Math.max(VIEWPORT_PADDING, rect.top - SIDE_OFFSET - renderedHeight)

    let left: number
    if (align === 'end') left = rect.right - menuWidth
    else if (align === 'center') left = rect.left + rect.width / 2 - menuWidth / 2
    else left = rect.left
    left = Math.min(
      Math.max(left, VIEWPORT_PADDING),
      Math.max(VIEWPORT_PADDING, viewportWidth - menuWidth - VIEWPORT_PADDING),
    )

    const anchorHidden =
      rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth

    const next: MenuPosition = {
      top: Math.max(VIEWPORT_PADDING, top),
      left,
      minWidth: rect.width,
      width: matchTriggerWidth ? rect.width : undefined,
      maxHeight,
      side,
      anchorHidden,
    }

    // The menu is observed for resize, and resizing is exactly what applying a
    // new max-height does — so bail out when nothing moved. Without this the
    // observer and the measurement feed each other in a loop.
    setPosition((current) => (current && samePosition(current, next) ? current : next))
  }, [triggerRef, menuRef, listRef, align, matchTriggerWidth, maxListHeight])

  const schedule = React.useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      measure()
    })
  }, [measure])

  React.useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    measure()

    // `true` captures scrolls on every ancestor, not just the window, so a
    // dropdown inside a scrollable panel or a table body tracks correctly.
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    if (observer) {
      if (menuRef.current) observer.observe(menuRef.current)
      if (triggerRef.current) observer.observe(triggerRef.current)
    }

    return () => {
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [open, measure, schedule, menuRef, triggerRef])

  return position
}

/* ------------------------------------------------------------------ *
 * Keyboard navigation model
 * ------------------------------------------------------------------ */

type NavItem<T> =
  | { kind: 'create'; id: string; disabled: boolean }
  | { kind: 'action'; id: string; disabled: boolean; action: DropdownAction }
  | { kind: 'reset'; id: string; disabled: boolean }
  | { kind: 'option'; id: string; disabled: boolean; option: DropdownOption<T> }

/* ------------------------------------------------------------------ *
 * Props
 * ------------------------------------------------------------------ */

export type DropdownProps<T> = DropdownTriggerVariants & {
  /* -- value (single select) -- */
  value?: T | null
  onChange?: (next: T | null) => void

  /* -- value (multi select) -- */
  /** Presence of this prop switches the dropdown into multi-select. */
  multiValues?: T[]
  /** Called with the toggled value. Prefer `onMultiChange` for the full list. */
  onToggleValue?: (value: T) => void
  /** Called with the complete next selection. */
  onMultiChange?: (next: T[]) => void
  /** How a selected row reads in multi-select. `check` matches single-select
   *  (trailing tick); `checkbox` adds a leading box — clearer for long lists. */
  multiIndicator?: 'check' | 'checkbox'

  /* -- data -- */
  options?: DropdownOption<T>[]
  /** Grouped options. Takes precedence over `options` when both are passed. */
  groups?: DropdownGroup<T>[]

  /* -- trigger -- */
  placeholder: string
  /** Leading trigger visual. Defaults to a filter glyph; pass `false` for none. */
  triggerLeading?: React.ReactNode | false
  /** Replaces the computed trigger text entirely (badge counts, rich labels). */
  triggerLabel?: React.ReactNode
  ariaLabel?: string
  /** Reserve the trigger's widest label so it does not resize as the value
   *  changes — stops filter bars jittering. */
  stableWidth?: boolean
  /** Show an inline × on the trigger once a value is set. */
  clearable?: boolean

  /* -- menu -- */
  align?: DropdownAlign
  /** Force the menu to the trigger's width — the norm for `field` dropdowns. */
  matchTriggerWidth?: boolean
  /** Cap on the scrollable list region. Defaults to 288px. */
  maxListHeight?: number
  /** Render the menu above modals and drawers (`z-top`). Use for a dropdown
   *  inside an already-elevated surface that must not be covered. */
  elevated?: boolean

  /* -- search -- */
  /** Adds a search field inside the menu. Pass a string for the placeholder. */
  searchable?: boolean | string
  /** Replaces the built-in `label`/`keywords` substring match. */
  filterOption?: (option: DropdownOption<T>, query: string) => boolean
  /** Notified on every keystroke — hook up async/server-side search here. */
  onSearchChange?: (query: string) => void

  /* -- extras -- */
  /** A row that clears the selection, e.g. "All statuses". */
  resetLabel?: string
  /** Command rows pinned above the options. */
  actions?: DropdownAction[]
  /**
   * Renders the popup as a command MENU (`role="menu"` / `menuitem`) rather
   * than a listbox. Use it when the rows are commands with no selected value —
   * a table row's kebab, a bulk-action menu. `actions` become the menu's items;
   * `options` may still be passed alongside for a menu that also picks a value.
   *
   * The two ARIA patterns are not interchangeable: a listbox announces "3 of 7,
   * selected"; a menu announces a command. Picking the wrong one is the
   * difference between a screen reader describing a delete button as an
   * unselected option and describing it as an action.
   */
  menu?: boolean
  /** Offers "Create <query>" when the search text matches no option. */
  createOption?: {
    onCreate: (name: string) => void
    label?: (name: string) => string
    disabled?: boolean
  }
  footer?: React.ReactNode

  /* -- state -- */
  disabled?: boolean
  /** Tooltip explaining why the trigger is disabled. */
  disabledReason?: string
  isLoading?: boolean
  loadingLabel?: string
  /** Trigger text and menu message when there are no options at all. */
  emptyLabel?: string
  noResultsLabel?: string

  /* -- escape hatches -- */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  renderOption?: (option: DropdownOption<T>, state: { selected: boolean; active: boolean }) => React.ReactNode
  renderOptionTrailing?: (
    option: DropdownOption<T>,
    selected: boolean,
    close: () => void,
  ) => React.ReactNode
  className?: string
  triggerClassName?: string
  menuClassName?: string
  'data-testid'?: string
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

/**
 * One dropdown for every menu scenario in the backend: single select, multi
 * select, grouped options, in-menu search, creatable values, command rows,
 * async loading and empty states — all behind one prop surface.
 *
 * **Placement.** The menu portals to `document.body` and is positioned against
 * the viewport, so nothing clips it: not a table's `overflow: hidden`, not a
 * drawer's transform, not a card's stacking context. It flips above the
 * trigger when space below runs out, shifts to stay inside the viewport, and
 * shrinks to scroll internally instead of overflowing the fold.
 *
 * **Layering.** Uses the DS z-index scale — `z-popover` (45) sits above
 * `z-modal` (40) so a dropdown opened inside a dialog or filter panel renders
 * over it. Pass `elevated` for `z-top` (100) when it must clear even that.
 *
 * **Keyboard.** Arrow keys move, Home/End jump, Enter/Space selects, Escape
 * closes and restores focus, Tab closes. Without a search field, typing jumps
 * to the matching option.
 *
 * @example Filter-bar select
 * ```tsx
 * <Dropdown
 *   value={status}
 *   onChange={setStatus}
 *   options={statusOptions}
 *   placeholder="Status"
 *   resetLabel="All statuses"
 * />
 * ```
 *
 * @example Searchable multi-select in a form
 * ```tsx
 * <Dropdown
 *   variant="field"
 *   matchTriggerWidth
 *   multiValues={tagIds}
 *   onMultiChange={setTagIds}
 *   multiIndicator="checkbox"
 *   options={tagOptions}
 *   placeholder="Select tags"
 *   searchable="Search tags…"
 * />
 * ```
 */
export function Dropdown<T>({
  value = null,
  onChange,
  multiValues,
  onToggleValue,
  onMultiChange,
  multiIndicator = 'check',
  options,
  groups,
  placeholder,
  triggerLeading,
  triggerLabel,
  ariaLabel,
  stableWidth,
  clearable = false,
  align = 'start',
  matchTriggerWidth,
  maxListHeight = DEFAULT_MAX_LIST_HEIGHT,
  elevated = false,
  searchable = false,
  filterOption,
  onSearchChange,
  resetLabel,
  actions,
  menu: isMenu = false,
  createOption,
  footer,
  disabled = false,
  disabledReason,
  isLoading = false,
  loadingLabel,
  emptyLabel,
  noResultsLabel,
  open: controlledOpen,
  onOpenChange,
  renderOption,
  renderOptionTrailing,
  variant = 'filter',
  size = 'default',
  className,
  triggerClassName,
  menuClassName,
  'data-testid': testId,
}: DropdownProps<T>) {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const baseId = React.useId()

  const resolvedLoadingLabel = loadingLabel ?? t('ui.dropdown.loading', 'Loading…')
  const resolvedNoResults = noResultsLabel ?? t('ui.dropdown.noMatches', 'No matches.')
  const searchPlaceholder =
    typeof searchable === 'string' ? searchable : t('ui.dropdown.search', 'Search…')
  const clearLabel = t('ui.dropdown.clear', 'Clear selection')

  /* -- open state (controlled or not) -- */
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const isOpen = controlledOpen ?? uncontrolledOpen
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [controlledOpen, onOpenChange],
  )

  const [query, setQuery] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const [mounted, setMounted] = React.useState(false)

  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const searchRef = React.useRef<HTMLInputElement | null>(null)
  const typeaheadRef = React.useRef({ buffer: '', at: 0 })

  React.useEffect(() => setMounted(true), [])

  /* -- derived data -- */
  const flatOptions = React.useMemo(
    () => (groups ? groups.flatMap((group) => group.options) : (options ?? [])),
    [groups, options],
  )

  const isMulti = multiValues !== undefined
  const selectedValues = React.useMemo(() => multiValues ?? [], [multiValues])

  const isEmpty = !isLoading && flatOptions.length === 0
  const hasExtras = Boolean(actions?.length || createOption || resetLabel)
  const isDisabled = disabled || (isEmpty && !hasExtras)

  const isOptionSelected = React.useCallback(
    (option: DropdownOption<T>) =>
      isMulti
        ? selectedValues.some((candidate) => Object.is(option.value, candidate))
        : value !== null && Object.is(option.value, value),
    [isMulti, selectedValues, value],
  )

  const selectedOption = React.useMemo(
    () =>
      !isMulti && value !== null
        ? (flatOptions.find((option) => Object.is(option.value, value)) ?? null)
        : null,
    [isMulti, value, flatOptions],
  )

  const selectedOptions = React.useMemo(
    () => (isMulti ? flatOptions.filter(isOptionSelected) : []),
    [isMulti, flatOptions, isOptionSelected],
  )

  const hasSelection = isMulti ? selectedOptions.length > 0 : selectedOption !== null

  /* -- filtering -- */
  const trimmedQuery = query.trim().toLowerCase()

  const matches = React.useCallback(
    (option: DropdownOption<T>) => {
      if (!trimmedQuery) return true
      if (filterOption) return filterOption(option, trimmedQuery)
      if (option.label.toLowerCase().includes(trimmedQuery)) return true
      if (option.description?.toLowerCase().includes(trimmedQuery)) return true
      return (option.keywords ?? []).some((keyword) =>
        keyword.toLowerCase().includes(trimmedQuery),
      )
    },
    [trimmedQuery, filterOption],
  )

  const visibleGroups = React.useMemo(() => {
    if (!groups) return null
    if (!trimmedQuery) return groups
    return groups
      .map((group) => ({ ...group, options: group.options.filter(matches) }))
      .filter((group) => group.options.length > 0)
  }, [groups, trimmedQuery, matches])

  const visibleOptions = React.useMemo(() => {
    if (groups) return null
    if (!trimmedQuery) return (options ?? [])
    return (options ?? []).filter(matches)
  }, [groups, options, trimmedQuery, matches])

  const visibleFlatOptions = React.useMemo(
    () => visibleGroups?.flatMap((group) => group.options) ?? visibleOptions ?? [],
    [visibleGroups, visibleOptions],
  )

  const hasResults = visibleFlatOptions.length > 0

  const creatableName = React.useMemo(() => {
    if (!createOption) return null
    const typed = query.trim()
    if (!typed) return null
    const taken = flatOptions.some(
      (option) => option.label.trim().toLowerCase() === typed.toLowerCase(),
    )
    return taken ? null : typed
  }, [createOption, query, flatOptions])

  /* -- keyboard navigation model -------------------------------------
     One flat list in render order so arrow keys walk the create row,
     command rows, the reset row and every option as a single sequence. */
  const navItems = React.useMemo(() => {
    const items: NavItem<T>[] = []
    if (creatableName) {
      items.push({ kind: 'create', id: `${baseId}-create`, disabled: Boolean(createOption?.disabled) })
    }
    if (!trimmedQuery) {
      for (const [index, action] of (actions ?? []).entries()) {
        items.push({
          kind: 'action',
          id: `${baseId}-action-${action.id ?? index}`,
          disabled: Boolean(action.disabled),
          action,
        })
      }
      if (resetLabel) {
        items.push({ kind: 'reset', id: `${baseId}-reset`, disabled: false })
      }
    }
    for (const [index, option] of visibleFlatOptions.entries()) {
      items.push({
        kind: 'option',
        id: `${baseId}-option-${index}`,
        disabled: Boolean(option.disabled),
        option,
      })
    }
    return items
  }, [creatableName, createOption, trimmedQuery, actions, resetLabel, visibleFlatOptions, baseId])

  const navIndexOf = React.useCallback(
    (option: DropdownOption<T>) =>
      navItems.findIndex((item) => item.kind === 'option' && item.option === option),
    [navItems],
  )

  /* -- placement -- */
  const position = useAnchoredMenu({
    open: isOpen,
    triggerRef,
    menuRef,
    listRef,
    align,
    matchTriggerWidth: Boolean(matchTriggerWidth ?? variant === 'field'),
    maxListHeight,
  })

  /* -- open/close side effects -- */
  const close = React.useCallback(
    (restoreFocus = true) => {
      setOpen(false)
      if (restoreFocus) triggerRef.current?.focus()
    },
    [setOpen],
  )

  React.useEffect(() => {
    if (!isOpen) {
      setQuery('')
      setActiveIndex(-1)
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    // Escape is handled on the menu too, but focus can legitimately leave it
    // (a consumer focusing something from `footer`), and a dropdown that will
    // not close on Escape is a trap.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
    }

    // Capture phase so the dropdown closes even when an inner surface stops
    // propagation (dialogs, editors, drag handlers).
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [isOpen, setOpen, close])

  // Focus the search field on open; otherwise the menu itself takes focus so
  // arrow keys work immediately.
  React.useLayoutEffect(() => {
    if (!isOpen) return
    if (searchable) searchRef.current?.focus()
    else menuRef.current?.focus()
  }, [isOpen, searchable])

  // Point the active row at the current selection when the menu opens.
  React.useEffect(() => {
    if (!isOpen) return
    const target = selectedOption ?? selectedOptions[0] ?? null
    setActiveIndex(target ? navIndexOf(target) : navItems.findIndex((item) => !item.disabled))
    // Only when the menu opens — later keystrokes own `activeIndex`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Keep the active row inside the scroll viewport.
  React.useEffect(() => {
    if (!isOpen || activeIndex < 0) return
    const item = navItems[activeIndex]
    if (!item) return
    document.getElementById(item.id)?.scrollIntoView({ block: 'nearest' })
  }, [isOpen, activeIndex, navItems])

  // A filtered list can be shorter than the remembered index.
  React.useEffect(() => {
    if (activeIndex >= navItems.length) {
      setActiveIndex(navItems.findIndex((item) => !item.disabled))
    }
  }, [navItems, activeIndex])

  /* -- selection -- */
  const commitOption = React.useCallback(
    (option: DropdownOption<T>) => {
      if (option.disabled) return
      if (isMulti) {
        onToggleValue?.(option.value)
        if (onMultiChange) {
          const next = selectedValues.some((candidate) => Object.is(candidate, option.value))
            ? selectedValues.filter((candidate) => !Object.is(candidate, option.value))
            : [...selectedValues, option.value]
          onMultiChange(next)
        }
        return
      }
      onChange?.(option.value)
      close()
    },
    [isMulti, onToggleValue, onMultiChange, selectedValues, onChange, close],
  )

  const commitReset = React.useCallback(() => {
    if (isMulti) onMultiChange?.([])
    else onChange?.(null)
    close()
  }, [isMulti, onMultiChange, onChange, close])

  const commitNavItem = React.useCallback(
    (item: NavItem<T>) => {
      if (item.disabled) return
      switch (item.kind) {
        case 'create':
          if (creatableName) {
            createOption?.onCreate(creatableName)
            setQuery('')
            close()
          }
          break
        case 'action':
          item.action.onSelect?.()
          close()
          break
        case 'reset':
          commitReset()
          break
        case 'option':
          commitOption(item.option)
          break
      }
    },
    [creatableName, createOption, close, commitReset, commitOption],
  )

  /* -- keyboard -- */
  const moveActive = React.useCallback(
    (direction: 1 | -1, from?: number) => {
      const count = navItems.length
      if (count === 0) return
      // From -1 (nothing active yet), one step back must land on the last row,
      // so normalise into range rather than relying on a positive bias term.
      const start = from ?? activeIndex
      for (let step = 1; step <= count; step += 1) {
        const next = (((start + direction * step) % count) + count) % count
        if (!navItems[next]?.disabled) {
          setActiveIndex(next)
          return
        }
      }
    },
    [navItems, activeIndex],
  )

  const jumpActive = React.useCallback(
    (edge: 'first' | 'last') => {
      const indices = navItems.map((item, index) => ({ item, index })).filter(({ item }) => !item.disabled)
      if (indices.length === 0) return
      setActiveIndex(edge === 'first' ? indices[0].index : indices[indices.length - 1].index)
    },
    [navItems],
  )

  const runTypeahead = React.useCallback(
    (char: string) => {
      const now = Date.now()
      const state = typeaheadRef.current
      state.buffer = now - state.at > 600 ? char : state.buffer + char
      state.at = now
      const needle = state.buffer.toLowerCase()
      const found = navItems.findIndex(
        (item) => item.kind === 'option' && !item.disabled && item.option.label.toLowerCase().startsWith(needle),
      )
      if (found >= 0) setActiveIndex(found)
    },
    [navItems],
  )

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (isOpen) return
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen(true)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      // Resolved once the menu renders; `jumpActive` needs the nav list.
      window.requestAnimationFrame(() => jumpActive('last'))
    }
  }

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        close()
        return
      case 'Tab':
        setOpen(false)
        return
      case 'ArrowDown':
        event.preventDefault()
        moveActive(1)
        return
      case 'ArrowUp':
        event.preventDefault()
        moveActive(-1)
        return
      case 'Home':
        event.preventDefault()
        jumpActive('first')
        return
      case 'End':
        event.preventDefault()
        jumpActive('last')
        return
      case 'Enter': {
        const item = navItems[activeIndex]
        if (item) {
          event.preventDefault()
          commitNavItem(item)
        }
        return
      }
      case ' ': {
        // Space types into the search field; elsewhere it selects.
        if (searchable) return
        const item = navItems[activeIndex]
        if (item) {
          event.preventDefault()
          commitNavItem(item)
        }
        return
      }
      default:
        if (!searchable && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          runTypeahead(event.key)
        }
    }
  }

  /* -- trigger label -- */
  const computedLabel = (() => {
    if (triggerLabel !== undefined) return triggerLabel
    if (isLoading) return resolvedLoadingLabel
    if (isEmpty && emptyLabel) return emptyLabel
    if (isMulti) {
      if (selectedOptions.length === 0) return placeholder
      if (selectedOptions.length === 1) return selectedOptions[0].label
      return t('ui.dropdown.selectedCount', '{count} selected', { count: selectedOptions.length })
    }
    return selectedOption?.label ?? placeholder
  })()

  // Ghost copies of the widest candidate labels stack under the real one in a
  // 1×1 grid, so the trigger is already as wide as its widest future value.
  const measuredLabels = React.useMemo(() => {
    if (!stableWidth) return []
    const labels = new Set<string>([placeholder])
    if (resolvedLoadingLabel) labels.add(resolvedLoadingLabel)
    if (resetLabel) labels.add(resetLabel)
    if (emptyLabel) labels.add(emptyLabel)
    for (const option of flatOptions) labels.add(option.label)
    return Array.from(labels)
      .sort((a, b) => b.length - a.length)
      .slice(0, MAX_MEASURED_LABELS)
  }, [stableWidth, placeholder, resolvedLoadingLabel, resetLabel, emptyLabel, flatOptions])

  const triggerStateClass =
    variant !== 'filter'
      ? isDisabled
        ? 'text-text-disabled'
        : 'text-foreground'
      : isDisabled
        ? 'cursor-not-allowed border-border text-disabled-foreground'
        : hasSelection
          ? 'border-accent-border text-accent-strong hover:bg-accent-soft'
          : 'border-border text-foreground hover:bg-surface-muted'

  const title = disabled ? disabledReason : isEmpty ? emptyLabel : undefined

  /* -- menu chrome -- */
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    top: position?.top ?? 0,
    left: position?.left ?? 0,
    minWidth: position?.minWidth,
    width: position?.width,
    maxWidth: `calc(100vw - ${VIEWPORT_PADDING * 2}px)`,
    maxHeight: position?.maxHeight,
    // Hidden until measured, so the menu never paints at 0,0 for a frame.
    visibility: position && !position.anchorHidden ? 'visible' : 'hidden',
    pointerEvents: position?.anchorHidden ? 'none' : undefined,
  }

  const side = position?.side ?? 'bottom'
  const enterOffset = side === 'bottom' ? -4 : 4

  const menu = (
    <motion.div
      ref={menuRef}
      tabIndex={-1}
      style={menuStyle}
      onKeyDown={onMenuKeyDown}
      data-slot="dropdown-menu"
      data-side={side}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: enterOffset, scale: 0.98 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: enterOffset, scale: 0.98 }}
      transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.4, 0, 0.2, 1] }}
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-border bg-surface p-2 shadow-lg outline-none',
        side === 'bottom' ? 'origin-top' : 'origin-bottom',
        elevated ? 'z-top' : 'z-popover',
        menuClassName,
      )}
    >
      {searchable ? (
        <div className="mb-1 shrink-0 pb-1">
          <label className="relative block w-full">
            <span className="sr-only">{searchPlaceholder}</span>
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-disabled-foreground"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${baseId}-listbox`}
              // Only an option may be the active descendant: the attribute has
              // to name an element inside the controlled listbox, and command
              // rows deliberately live outside it.
              aria-activedescendant={
                navItems[activeIndex]?.kind === 'option' ? navItems[activeIndex]?.id : undefined
              }
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                onSearchChange?.(event.target.value)
              }}
              placeholder={searchPlaceholder}
              className={cn(
                'w-full rounded-md border border-border py-1.5 pl-7 text-sm font-medium text-foreground outline-none transition-colors',
                'placeholder:font-normal placeholder:text-disabled-foreground',
                query ? 'bg-modal-muted pr-7' : 'bg-surface pr-2 hover:bg-modal-muted',
              )}
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  onSearchChange?.('')
                  searchRef.current?.focus()
                }}
                aria-label={t('ui.dropdown.clearSearch', 'Clear search')}
                className="absolute right-1.5 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-disabled-foreground transition-colors hover:bg-modal-muted hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </label>
        </div>
      ) : null}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" data-slot="dropdown-list">
        {isLoading ? (
          <p className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
            <Spinner size="sm" className="size-3.5" />
            {resolvedLoadingLabel}
          </p>
        ) : null}

        {!isLoading && navItems.some((item) => item.kind !== 'option') ? (
          /* A <ul>, not a <div>: `MenuRow` emits `<li>`, which is only valid
             inside a list. In menu mode this IS the menu. */
          <ul
            id={isMenu ? `${baseId}-listbox` : undefined}
            role={isMenu ? 'menu' : 'presentation'}
            aria-label={isMenu ? (ariaLabel ?? placeholder) : undefined}
            className="flex flex-col gap-1"
          >
            {navItems
              .filter((item) => item.kind !== 'option')
              .map((item) => {
                const index = navItems.indexOf(item)
                const active = index === activeIndex
                if (item.kind === 'create') {
                  return (
                    <MenuRow
                      key={item.id}
                      id={item.id}
                      active={active}
                      disabled={item.disabled}
                      accent
                      onSelect={() => commitNavItem(item)}
                      onHover={() => setActiveIndex(index)}
                    >
                      <Plus className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="flex-1 truncate text-left">
                        {createOption?.label?.(creatableName ?? '') ??
                          t('ui.dropdown.create', 'Create "{name}"', { name: creatableName ?? '' })}
                      </span>
                    </MenuRow>
                  )
                }
                if (item.kind === 'action') {
                  return (
                    <MenuRow
                      key={item.id}
                      id={item.id}
                      role={isMenu ? 'menuitem' : undefined}
                      active={active}
                      disabled={item.disabled}
                      destructive={item.action.destructive}
                      href={item.action.href}
                      onSelect={() => commitNavItem(item)}
                      onHover={() => setActiveIndex(index)}
                    >
                      {item.action.leading}
                      <span className="flex-1 truncate text-left">{item.action.label}</span>
                    </MenuRow>
                  )
                }
                const resetSelected = isMulti ? selectedOptions.length === 0 : value === null
                return (
                  <MenuRow
                    key={item.id}
                    id={item.id}
                    active={active}
                    selected={resetSelected}
                    onSelect={() => commitNavItem(item)}
                    onHover={() => setActiveIndex(index)}
                  >
                    {triggerLeading === false ? null : (
                      triggerLeading ?? <Filter className="size-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span className="flex-1 truncate text-left">{resetLabel}</span>
                    {resetSelected ? <Check className="size-3.5 text-accent-strong" aria-hidden="true" /> : null}
                  </MenuRow>
                )
              })}
          </ul>
        ) : null}

        <ul
          id={`${baseId}-listbox`}
          role="listbox"
          aria-label={ariaLabel ?? placeholder}
          aria-multiselectable={isMulti || undefined}
          className="flex flex-col gap-1"
          hidden={isMenu && flatOptions.length === 0 ? true : undefined}
        >
          {visibleGroups
            ? visibleGroups.map((group, groupIndex) => (
                <li key={`${group.label}-${groupIndex}`} role="presentation">
                  <p className="px-3 pb-1 pt-2 text-overline font-semibold uppercase tracking-wider text-disabled-foreground">
                    {group.label}
                  </p>
                  {group.description ? (
                    <p className="px-3 pb-1.5 text-xs leading-snug text-muted-foreground">{group.description}</p>
                  ) : null}
                  <ul role="group" aria-label={group.label} className="flex flex-col gap-1">
                    {group.options.map((option) => renderOptionRow(option))}
                  </ul>
                </li>
              ))
            : (visibleOptions ?? []).map((option) => renderOptionRow(option))}
        </ul>

        {!isLoading && trimmedQuery && !hasResults && !creatableName ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">{resolvedNoResults}</p>
        ) : null}

        {!isLoading && !trimmedQuery && isEmpty && emptyLabel ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">{emptyLabel}</p>
        ) : null}
      </div>

      {footer ? (
        <div className="mt-1 shrink-0 border-t border-border px-3 pt-2 text-xs">{footer}</div>
      ) : null}
    </motion.div>
  )

  function renderOptionRow(option: DropdownOption<T>) {
    const index = navIndexOf(option)
    const item = navItems[index]
    const selected = isOptionSelected(option)
    const active = index === activeIndex
    const trailing = renderOptionTrailing?.(option, selected, () => close(false))

    return (
      <MenuRow
        key={item?.id ?? option.label}
        id={item?.id}
        role="option"
        selected={selected}
        active={active}
        disabled={option.disabled}
        trailing={trailing}
        onSelect={() => commitOption(option)}
        onHover={() => index >= 0 && setActiveIndex(index)}
      >
        {renderOption ? (
          renderOption(option, { selected, active })
        ) : (
          <>
            {isMulti && multiIndicator === 'checkbox' ? (
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                  selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface',
                )}
              >
                {selected ? <Check className="size-3" /> : null}
              </span>
            ) : null}
            {option.leading}
            <span className="flex min-w-0 flex-1 flex-col text-left">
              <span className="truncate">{option.label}</span>
              {option.description ? (
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </span>
            {option.trailing}
            {selected && !(isMulti && multiIndicator === 'checkbox') ? (
              <Check className="size-3.5 shrink-0 text-accent-strong" aria-hidden="true" />
            ) : null}
          </>
        )}
      </MenuRow>
    )
  }

  return (
    <div className={cn('relative inline-flex', variant === 'field' && 'w-full', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={isDisabled || isLoading}
        onClick={() => setOpen(!isOpen)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup={isMenu ? 'menu' : 'listbox'}
        aria-expanded={isOpen}
        aria-controls={isOpen ? `${baseId}-listbox` : undefined}
        aria-label={ariaLabel ?? placeholder}
        title={title}
        data-slot="dropdown-trigger"
        data-testid={testId}
        data-state={isOpen ? 'open' : 'closed'}
        className={cn(dropdownTriggerVariants({ variant, size }), triggerStateClass, triggerClassName)}
      >
        {selectedOption?.leading ??
          (triggerLeading === false ? null : (
            <span aria-hidden="true" className="shrink-0">
              {triggerLeading ?? <Filter className="size-3.5" aria-hidden="true" />}
            </span>
          ))}

        <span className="grid min-w-0">
          {measuredLabels.map((label) => (
            <span
              key={`measure-${label}`}
              aria-hidden="true"
              className="invisible col-start-1 row-start-1 whitespace-nowrap"
            >
              {label}
            </span>
          ))}
          <span className="col-start-1 row-start-1 truncate text-left">{computedLabel}</span>
        </span>

        {clearable && hasSelection && !isDisabled ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label={clearLabel}
            onPointerDown={(event) => {
              // Beat the trigger's onClick so clearing does not also open the menu.
              event.preventDefault()
              event.stopPropagation()
              commitReset()
            }}
            className="ml-auto inline-flex size-4 shrink-0 items-center justify-center rounded text-disabled-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
          </span>
        ) : null}

        {isLoading ? (
          <Spinner size="sm" className="ml-auto shrink-0" />
        ) : !isEmpty || hasExtras ? (
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0 transition-transform duration-150',
              clearable && hasSelection ? '' : 'ml-auto',
              variant === 'filter' && !hasSelection ? 'text-disabled-foreground' : 'opacity-70',
              isOpen && 'rotate-180',
            )}
          />
        ) : null}
      </button>

      {mounted ? createPortal(<AnimatePresence>{isOpen ? menu : null}</AnimatePresence>, document.body) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Row
 * ------------------------------------------------------------------ */

type MenuRowProps = {
  id?: string
  role?: 'option' | 'menuitem'
  /** Renders the row as an anchor so middle-click / new-tab work. */
  href?: string
  destructive?: boolean
  selected?: boolean
  active?: boolean
  disabled?: boolean
  accent?: boolean
  trailing?: React.ReactNode
  onSelect: () => void
  onHover?: () => void
  children: React.ReactNode
}

/**
 * A single menu row. Hover and keyboard focus share one visual state
 * (`active`) so the pointer and the arrow keys never disagree about which row
 * is next — the row under the cursor is the row Enter would pick.
 */
function MenuRow({
  id,
  role,
  href,
  destructive = false,
  selected = false,
  active = false,
  disabled = false,
  accent = false,
  trailing,
  onSelect,
  onHover,
  children,
}: MenuRowProps) {
  const rowClass = cn(
    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors outline-none',
    destructive ? 'text-destructive' : accent ? 'text-accent-strong' : 'text-foreground',
    active && !disabled && (destructive ? 'bg-status-error-bg' : 'bg-surface-muted'),
    selected && 'bg-surface-muted',
    disabled && 'cursor-not-allowed text-disabled-foreground',
  )

  // An option IS the interactive element — the click handler goes on the `li`
  // itself rather than on a nested `<button>`. A listbox option must not
  // contain interactive descendants (a nested button is both invalid ARIA and
  // a second, competing focus target), and keyboard activation is owned by the
  // menu's `aria-activedescendant` model, not by focusing each row.
  if (role === 'option') {
    return (
      <li
        id={id}
        role="option"
        aria-selected={selected}
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onSelect}
        onPointerEnter={onHover}
        className={cn(rowClass, !disabled && 'cursor-pointer')}
      >
        {children}
        {trailing ? (
          // The escape hatch for a per-row control. It stops propagation so
          // operating it does not also pick the option.
          <span
            className="ml-auto pl-1"
            onClick={(event) => event.stopPropagation()}
          >
            {trailing}
          </span>
        ) : null}
      </li>
    )
  }

  // Command rows (create / actions / reset) are not options — they stay real
  // buttons, and sit outside the listbox in the menu body. A row with an `href`
  // becomes an anchor instead, so middle-click and "open in new tab" behave the
  // way they do everywhere else in the product.
  return (
    <li role={role ? 'none' : undefined} onPointerEnter={onHover}>
      {href && !disabled ? (
        <a id={id} role={role} href={href} onClick={onSelect} className={rowClass} tabIndex={-1}>
          {children}
        </a>
      ) : (
        <button
          id={id}
          role={role}
          type="button"
          disabled={disabled}
          onClick={onSelect}
          className={rowClass}
          tabIndex={-1}
        >
          {children}
        </button>
      )}
    </li>
  )
}
