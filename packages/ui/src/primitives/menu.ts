import { cva, type VariantProps } from 'class-variance-authority'

/**
 * Shared geometry and state fills for every menu surface in the product — the
 * `Select` and `Dropdown` primitives, the command palette, and the popover
 * menus that cannot use either. One source of truth so a row in a row-actions
 * menu and a row in a select read as the same control.
 *
 * Two rules the fills encode:
 *
 * - **Rows never share an edge.** `mt-1` keeps adjacent backgrounds apart, so a
 *   hovered row beside the current value reads as two fills rather than one
 *   merged block. The margin rather than a flex `gap` is deliberate: a menu list
 *   is usually its own scroll container, and flex children in one shrink to fit
 *   instead of scrolling.
 * - **`selected` and `active` are different fills.** A menu that paints the
 *   current value and the hovered row with the same token leaves the pointer
 *   with nothing to say where it is. `selected` also carries weight, because
 *   `primary-soft` and `surface-muted` sit close together in both themes.
 */

/** Row spacing alone, for hosts whose row geometry is owned by a primitive. */
export const MENU_ROW_SPACING = 'mt-1 first:mt-0'

/** Hover fill for a menu row. Matches the `active` fill below. */
export const MENU_ROW_HOVER = 'hover:bg-surface-muted'

/**
 * A complete menu row: spacing, geometry and state. For rows rendered as a raw
 * element. Rows rendered as a `Button` should take `menuRowStateClass` instead
 * and let the button own its radius, padding and hover.
 */
export const menuRowVariants = cva(
  `${MENU_ROW_SPACING} flex w-full items-center gap-2 rounded-md text-left transition-colors outline-none`,
  {
    variants: {
      size: {
        /** Matches `Select` / `Dropdown`. */
        default: 'px-3 py-2 text-sm',
        /** For dense popovers and inline editors. */
        compact: 'px-2 py-1.5 text-sm',
      },
      tone: {
        default: 'text-foreground',
        destructive: 'text-destructive',
      },
      /** Pointer or keyboard highlight — the row Enter would pick. */
      active: {
        true: '',
        false: '',
      },
      /** The current value. Outranks `active`, so a hovered selection stays selected. */
      selected: {
        true: 'font-medium text-foreground',
        false: '',
      },
      disabled: {
        true: 'cursor-not-allowed text-disabled-foreground',
        false: 'cursor-pointer',
      },
    },
    // Exactly one fill can ever apply, so the result is correct even for a
    // caller that does not run it through `cn`/tailwind-merge.
    compoundVariants: [
      { tone: 'default', active: true, selected: false, disabled: false, class: 'bg-surface-muted' },
      { tone: 'destructive', active: true, selected: false, disabled: false, class: 'bg-status-error-bg' },
      { selected: true, disabled: false, class: 'bg-primary-soft' },
    ],
    defaultVariants: {
      size: 'default',
      tone: 'default',
      active: false,
      selected: false,
      disabled: false,
    },
  },
)

export type MenuRowVariantProps = VariantProps<typeof menuRowVariants>

/**
 * The state fills on their own, for rows rendered as a `Button` — which already
 * owns radius, padding and hover, and would fight the geometry in
 * `menuRowVariants`.
 */
export function menuRowStateClass({
  active = false,
  selected = false,
  destructive = false,
}: {
  active?: boolean
  selected?: boolean
  destructive?: boolean
} = {}): string {
  if (selected) return 'bg-primary-soft font-medium text-foreground'
  if (active) return destructive ? 'bg-status-error-bg' : 'bg-surface-muted'
  return ''
}
