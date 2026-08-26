"use client"

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Spinner } from './spinner'
import { Kbd } from './kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

/* A search field is NOT a form field. `Input` is a bordered box on `input-bg`,
   because a form asks you to fill it in and the border is the invitation. A
   search box is an action you reach for, so it is borderless and carries a fill
   one step darker than whatever it sits on — the shape alone reads as "type
   here", and nothing competes with the rows of results beneath it.
 *
 * `size` sets the box (height, radius, padding, text). It never sets a width:
 * the wrapper is `w-full` and the caller sizes the container, which is what lets
 * the same component be a 320px toolbar filter and a full-bleed popover header.
 *
 * `tone` sets the ground. Every tone shares the box, so the field reads as one
 * component wherever it lands; only the fill and the ink move. `tone` is
 * declared after `size` so `tailwind-merge` lets `plain` win the padding and
 * radius it has to drop.
 *
 * The 1px border is transparent at rest rather than absent: it keeps the box so
 * a tone that paints a focus edge (`sidebar`) does not shift its own contents. */
const searchInputWrapperVariants = cva(
  'inline-flex w-full items-center border border-transparent transition-colors focus-within:outline-none has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-60',
  {
    variants: {
      size: {
        sm: 'h-8 gap-1.5 rounded-md px-2.5',
        default: 'h-9 gap-2 rounded-lg px-3',
        /* `lg` is deliberately the backend rail's row box — `h-10 px-3 gap-3`
           with a `size-5` glyph slot (see below). That is what puts the search
           magnifier on the same icon column as every nav row beneath it, and
           the placeholder where row labels start. Changing any of the three
           silently narrows the field against the rows. */
        lg: 'h-10 gap-3 rounded-xl px-3',
      },
      tone: {
        default:
          'bg-surface-muted hover:bg-surface-strong focus-within:shadow-focus',
        /* The focus halo here is a RING, not `shadow-focus`, because every
           Tailwind `shadow-*` writes the same `--tw-shadow` slot: adding
           `focus-within:shadow-focus` on top of `shadow-md` replaces the
           elevation instead of joining it, and the field visibly flattens the
           moment you click it. `--tw-ring-shadow` is a separate slot in the
           same `box-shadow` list, so a ring composes with the drop shadow. */
        raised:
          'bg-surface shadow-md hover:bg-modal-muted focus-within:ring-2 focus-within:ring-focus-ring/30',
        /* On navy a blue halo is invisible, so focus paints the edge instead —
           which is why the box keeps a transparent border at rest. */
        sidebar:
          'bg-sidebar-accent/50 hover:bg-sidebar-accent focus-within:bg-sidebar-accent focus-within:border-sidebar-ring',
        /* No focus halo by design: `plain` IS a popover's header row, always
           auto-focused and the only field there, so the caret is the indicator
           — the command-palette convention. A ring would draw a box around a
           row that deliberately has no box. */
        plain: 'rounded-none bg-transparent px-0',
      },
    },
    defaultVariants: {
      size: 'default',
      tone: 'default',
    },
  },
)

/* The value is `font-medium`, the placeholder `font-normal` — an empty field
   reads as a prompt and a filled one as data, before colour does any work. */
const searchInputElementVariants = cva(
  'min-w-0 flex-1 border-0 bg-transparent font-medium outline-none placeholder:font-normal disabled:cursor-not-allowed disabled:bg-transparent disabled:text-text-disabled [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none',
  {
    variants: {
      size: {
        sm: 'text-xs',
        default: 'text-sm',
        lg: 'text-sm',
      },
      tone: {
        default: 'text-foreground placeholder:text-disabled-foreground',
        raised: 'text-foreground placeholder:text-disabled-foreground',
        sidebar: 'text-sidebar-foreground placeholder:text-sidebar-muted-foreground',
        plain: 'text-foreground placeholder:text-muted-foreground',
      },
    },
    defaultVariants: {
      size: 'default',
      tone: 'default',
    },
  },
)

/* Leading glyph, spinner and the clear button all take the same quiet ink, so
   the trailing slot never pulls more attention than the text being typed.
 *
 * The glyph is always drawn at 16px but sits in a slot that widens with the
 * size — 20px at `lg`, matching the sidebar's `size-5` icon box, so the field
 * and the nav rows share one icon column. */
const searchInputAdornmentVariants = cva(
  'flex shrink-0 items-center justify-center [&_svg]:size-4',
  {
    variants: {
      size: {
        sm: 'size-4',
        default: 'size-4',
        lg: 'size-5',
      },
      tone: {
        default: 'text-disabled-foreground',
        raised: 'text-disabled-foreground',
        sidebar: 'text-sidebar-muted-foreground',
        plain: 'text-muted-foreground',
      },
    },
    defaultVariants: {
      size: 'default',
      tone: 'default',
    },
  },
)

const searchInputClearVariants = cva(
  'flex shrink-0 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:shadow-focus',
  {
    variants: {
      size: {
        sm: 'size-5',
        default: 'size-6',
        lg: 'size-6',
      },
      tone: {
        default: 'text-disabled-foreground hover:bg-surface-strong hover:text-foreground',
        raised: 'text-disabled-foreground hover:bg-modal-muted hover:text-foreground',
        sidebar: 'text-sidebar-muted-foreground hover:text-sidebar-accent-foreground',
        plain: 'text-muted-foreground hover:text-foreground',
      },
    },
    defaultVariants: {
      size: 'default',
      tone: 'default',
    },
  },
)

export type SearchInputTone = NonNullable<VariantProps<typeof searchInputWrapperVariants>['tone']>

export type SearchInputProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'size' | 'type' | 'onChange'> &
  VariantProps<typeof searchInputWrapperVariants> & {
    /** Controlled value. */
    value: string
    /** Called on every keystroke with the new value. */
    onChange: (next: string) => void
    /**
     * Called when the user presses the trailing × button.
     * Defaults to `onChange('')` — pass an explicit handler to also reset adjacent state
     * (e.g. cancel an in-flight request, reset paging).
     */
    onClear?: () => void
    /** Show the trailing × button when the value is non-empty. Defaults to `true`. */
    clearable?: boolean
    /** Optional className on the wrapper. */
    className?: string
    /** Optional className on the inner `<input>`. */
    inputClassName?: string
    /** Translated aria-label for the clear button. Defaults to `t('ui.inputs.searchInput.clear', 'Clear search')`. */
    clearLabel?: string
    /**
     * Show a trailing spinner while the typed value has not yet been applied
     * (debounce still pending, or the resulting request still in flight).
     * Purely an affordance — the field stays editable.
     */
    loading?: boolean
    /**
     * Keyboard hint shown in the trailing slot while the field is empty — `"⌘K"`,
     * `"⌘1"`. A bare string is wrapped in `Kbd`; pass a node to render your own.
     * Gives way to the clear button as soon as there is something to clear.
     */
    shortcut?: React.ReactNode
    /** Extra adornment rendered after the clear / shortcut slot (scope hints, counters). */
    trailing?: React.ReactNode
  }

/**
 * The one search field in Operis. Every search affordance — DataTable filter,
 * sidebar nav filter, command palette, lookup picker, popover header — renders
 * this component so the shape, the clear button, the keyboard hint and the
 * a11y contract are identical everywhere; only `size` and `tone` change.
 *
 * Sizing is `size` (the box) plus a width from the caller's container. Grounds
 * are `tone`: `default` on a card, `raised` on the page ground, `sidebar` on the
 * navy rail, `plain` when the field *is* a popover's header row.
 *
 * `type="search"` is fixed, so the element always exposes `role="searchbox"`.
 * The native clear button is suppressed — the DS renders a real `<button>`, so
 * clearing stays keyboard-reachable and screen-reader-labelled.
 */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      className,
      inputClassName,
      size,
      tone,
      value,
      onChange,
      onClear,
      clearable = true,
      clearLabel,
      placeholder,
      disabled,
      loading = false,
      shortcut,
      trailing,
      ...props
    },
    ref,
  ) => {
    const t = useT()
    const resolvedPlaceholder = placeholder ?? t('ui.inputs.searchInput.placeholder', 'Search…')
    const resolvedClearLabel = clearLabel ?? t('ui.inputs.searchInput.clear', 'Clear search')
    const showClear = clearable && value.length > 0 && !disabled && !loading
    const showShortcut = shortcut != null && value.length === 0 && !loading

    const handleClear = React.useCallback(() => {
      if (onClear) onClear()
      else onChange('')
    }, [onChange, onClear])

    /* The whole box is the click target, not just the 16px of text cursor
       between the glyph and the trailing slot. A `<label>` wrapper would give
       this natively, but `<label>` may not contain a labelable element other
       than its own control — and the clear button is one. So the padding is
       wired by hand, and only when the press landed on dead space: a press on
       the input or on the clear button is left completely alone. */
    const innerRef = React.useRef<HTMLInputElement | null>(null)
    const setRefs = React.useCallback(
      (node: HTMLInputElement | null) => {
        innerRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node
      },
      [ref],
    )

    const focusOnPadding = React.useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        if (disabled) return
        const target = event.target as HTMLElement | null
        if (!target || target.closest('input,button,a,[role="button"]')) return
        // preventDefault keeps the press from blurring an already-focused field.
        event.preventDefault()
        innerRef.current?.focus()
      },
      [disabled],
    )

    return (
      <div
        className={cn(searchInputWrapperVariants({ size, tone }), className)}
        data-slot="search-input-wrapper"
        data-tone={tone ?? 'default'}
        onMouseDown={focusOnPadding}
      >
        <span className={searchInputAdornmentVariants({ size, tone })} aria-hidden="true">
          <Search />
        </span>
        <input
          ref={setRefs}
          type="search"
          inputMode="search"
          autoComplete="off"
          placeholder={resolvedPlaceholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={cn(searchInputElementVariants({ size, tone }), inputClassName)}
          {...props}
        />
        {loading ? (
          <span className={searchInputAdornmentVariants({ size, tone })} aria-hidden="true">
            <Spinner className="size-4" />
          </span>
        ) : null}
        {showClear ? (
          <button
            type="button"
            onClick={handleClear}
            aria-label={resolvedClearLabel}
            data-slot="search-input-clear"
            className={searchInputClearVariants({ size, tone })}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : showShortcut ? (
          typeof shortcut === 'string' ? (
            <Kbd data-slot="search-input-shortcut" className="shrink-0">
              {shortcut}
            </Kbd>
          ) : (
            <span data-slot="search-input-shortcut" className="shrink-0">
              {shortcut}
            </span>
          )
        ) : null}
        {trailing}
      </div>
    )
  },
)
SearchInput.displayName = 'SearchInput'

export {
  searchInputWrapperVariants,
  searchInputElementVariants,
  searchInputAdornmentVariants,
  searchInputClearVariants,
}
