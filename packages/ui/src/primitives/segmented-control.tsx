"use client"

import * as React from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { cva, type VariantProps } from 'class-variance-authority'
import { motion, useReducedMotion } from 'framer-motion'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * iOS-style segmented control per Figma `Switch / Chart / Cryptocurrency`
 * (component set id `199963:1442` in DS Open Mercato). Renders a single
 * track with N items where exactly one is selected at a time. Selecting
 * a new item fires `onValueChange`.
 *
 * This is the ONE toggle primitive for mutually-exclusive state, and it covers
 * every shape that state comes in:
 * - **Compact filter** (default) — the track hugs its labels: list filters like
 *   "All / Active / Archived", chart period selectors, layout toggles.
 * - **Full-width form control** (`fullWidth`) — the track spans its container and
 *   every segment gets an equal share of it, for a field-like row of choices.
 * - **With or without icons** (`icon` on an item) — the icon is decorative and is
 *   excluded from the item's accessible name.
 *
 * For *related actions* (each does something different), reach for `ButtonGroup`;
 * for options that swap a content panel, reach for `Tabs`.
 *
 * Built on Radix `RadioGroup` so we inherit the radio-group ARIA contract
 * (`role="radiogroup"`, `role="radio"` on items, arrow-key navigation,
 * roving tabindex) for free. No new dependency — Radix RadioGroup is
 * already installed via the `Radio` primitive.
 *
 * **Geometry.** The track owns the height and a uniform `p-0.5` inset; items
 * stretch to the track's content box rather than carrying their own height. That
 * is what makes the selected pill sit exactly 2px from the rail on all four
 * sides — a fixed item height would leave a different gap vertically than
 * horizontally, which is visible as soon as the pill is a filled colour.
 *
 * **Motion.** The selected fill is a single shared element that slides
 * between segments rather than a class that blinks on and off, so the
 * control reads as one pill moving along a rail. It is driven by
 * framer-motion's shared-layout transition: the pill renders inside the
 * checked item, and when the selection moves, framer-motion measures both
 * positions and animates between them. Because it is a real layout
 * animation it stays correct when segment widths differ, when labels are
 * translated, and when the container resizes — no measurement code, no
 * `ResizeObserver`, nothing to keep in sync. Label colour crossfades over the
 * same window so ink and pill arrive together instead of the text snapping to
 * its selected colour while the pill is still in transit.
 *
 * ```tsx
 * const [view, setView] = React.useState('all')
 * <SegmentedControl value={view} onValueChange={setView} aria-label="View filter">
 *   <SegmentedControlItem value="all">All</SegmentedControlItem>
 *   <SegmentedControlItem value="active">Active</SegmentedControlItem>
 *   <SegmentedControlItem value="archived">Archived</SegmentedControlItem>
 * </SegmentedControl>
 * ```
 *
 * Sizes:
 * - `default` (h-9 / 36px) — standard toolbar density, matches Button/Input height.
 * - `sm` (h-8 / 32px) — tighter; pair with `text-xs`.
 */

type SegmentedControlContextValue = {
  size: 'sm' | 'default'
  fullWidth: boolean
  disabled?: boolean
  /** Scopes the sliding pill to this control — see `indicatorId` below. */
  indicatorId: string
}

const SegmentedControlContext = React.createContext<SegmentedControlContextValue>({
  size: 'default',
  fullWidth: false,
  disabled: false,
  indicatorId: 'segmented-control',
})

/** Matches the pill's travel to the DS "standard transition" (200ms) while
 *  keeping a spring's settle, so it arrives without the mechanical feel of a
 *  linear tween. Low mass keeps it from overshooting on short hops. */
const INDICATOR_TRANSITION = {
  type: 'spring',
  stiffness: 380,
  damping: 32,
  mass: 0.8,
} as const

const trackVariants = cva(
  // A bordered `surface` rail holding one filled item, matching the reference's
  // filter toggle. The track is NOT the muted step — inverting that (muted rail,
  // raised white pill) made the control read as a group of buttons rather than
  // as one control with a chosen segment.
  //
  // `items-stretch` is load-bearing: items derive their height from the track's
  // content box, so the pill's inset is the track's `p-0.5` on every side.
  //   default → h-9 (36px) − 2px border − 4px padding = 30px item, 2px all round
  //   sm      → h-8 (32px) − 2px border − 4px padding = 26px item, 2px all round
  'items-stretch gap-0 rounded-lg border border-border bg-surface p-0.5 transition-colors',
  {
    variants: {
      size: {
        sm: 'h-8',
        default: 'h-9',
      },
      // Display lives in the variant rather than the base so the two cases never
      // depend on which `display` utility Tailwind happens to emit last.
      fullWidth: {
        true: 'flex w-full',
        false: 'inline-flex w-fit',
      },
      disabled: {
        true: 'cursor-not-allowed opacity-60',
        false: '',
      },
    },
    defaultVariants: {
      size: 'default',
      fullWidth: false,
      disabled: false,
    },
  },
)

const itemVariants = cva(
  // The track is a bordered `surface` rail; the SELECTED item is the sidebar
  // navy plus a hairline lift — both painted by the sliding pill, not by a class
  // on the item, so only the text treatment lives here. Selected ink is the
  // sidebar's own foreground, which is what keeps the label legible once the
  // pill is a saturated fill. Unselected text is muted and hover only nudges
  // colour, so the rail stays flat and the single filled item is the whole signal.
  //
  // `relative` is load-bearing: the pill is positioned against the item.
  // The 200ms colour window matches the pill's travel so ink and fill land
  // together; `motion-reduce` drops it via CSS (not `useReducedMotion`) because
  // this class is emitted during SSR.
  'relative inline-flex items-center justify-center rounded-md font-medium ' +
    'transition-colors duration-200 motion-reduce:transition-none ' +
    'outline-none focus-visible:shadow-focus ' +
    'disabled:cursor-not-allowed disabled:opacity-50 ' +
    'data-[state=checked]:text-sidebar-foreground data-[state=checked]:font-semibold ' +
    'data-[state=unchecked]:bg-transparent data-[state=unchecked]:text-muted-foreground data-[state=unchecked]:hover:text-foreground',
  {
    variants: {
      size: {
        sm: 'gap-1.5 px-2.5 text-xs',
        default: 'gap-2 px-3 text-sm',
      },
      fullWidth: {
        // `basis-0` (not just `flex-1`) makes every segment an equal share of the
        // track instead of a share weighted by label length.
        true: 'min-w-0 flex-1 basis-0',
        false: '',
      },
    },
    defaultVariants: {
      size: 'default',
      fullWidth: false,
    },
  },
)

export type SegmentedControlProps = Omit<
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>,
  'orientation'
> &
  VariantProps<typeof trackVariants> & {
    /** Optional screen-reader label for the radio group. */
    'aria-label'?: string
  }

export const SegmentedControl = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  SegmentedControlProps
>(({ className, size, fullWidth, disabled, children, ...props }, ref) => {
  // The sliding pill is a shared layout element keyed by `layoutId`. That key
  // is global to framer-motion, so two segmented controls on one page sharing
  // a key would animate their pills into each other across the screen. A
  // per-instance id keeps each control's pill to itself.
  const instanceId = React.useId()
  const ctx = React.useMemo<SegmentedControlContextValue>(
    () => ({
      size: size ?? 'default',
      fullWidth: fullWidth ?? false,
      disabled: disabled ?? false,
      indicatorId: `segmented-control-indicator-${instanceId}`,
    }),
    [size, fullWidth, disabled, instanceId],
  )
  return (
    <SegmentedControlContext.Provider value={ctx}>
      <RadioGroupPrimitive.Root
        ref={ref}
        orientation="horizontal"
        disabled={disabled ?? undefined}
        data-slot="segmented-control"
        className={cn(trackVariants({ size, fullWidth, disabled }), className)}
        {...props}
      >
        {children}
      </RadioGroupPrimitive.Root>
    </SegmentedControlContext.Provider>
  )
})
SegmentedControl.displayName = 'SegmentedControl'

export type SegmentedControlItemProps = React.ComponentPropsWithoutRef<
  typeof RadioGroupPrimitive.Item
> & {
  /** Optional leading icon — typically a lucide-react icon at `size-4`.
   *  Rendered `aria-hidden`, so the item's accessible name stays its label. */
  icon?: React.ReactNode
}

export const SegmentedControlItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  SegmentedControlItemProps
>(({ className, children, icon, ...props }, ref) => {
  const {
    size,
    fullWidth,
    disabled: groupDisabled,
    indicatorId,
  } = React.useContext(SegmentedControlContext)
  const reduceMotion = useReducedMotion()

  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      data-slot="segmented-control-item"
      className={cn(
        itemVariants({ size, fullWidth }),
        // Disabling the root dims the track AND disables every item, so both
        // dimmers apply and multiply out to ~0.3 opacity — far fainter than
        // either intends, and below what a disabled control should still be
        // readable at. The track owns the group-disabled look; the item's own
        // dim is for a single item disabled inside an enabled group.
        groupDisabled && 'disabled:opacity-100',
        className,
      )}
      {...props}
    >
      {/* Radix mounts `Indicator` only on the checked item, so the pill moves
          by unmounting here and mounting there — which is precisely the
          transition framer-motion's shared layout animation is for.

          The element type stays `motion.span` in both motion preferences:
          `useReducedMotion` resolves on the client, so branching on it to
          render a different element would change the tree between SSR and
          hydration. Only the transition changes. */}
      <RadioGroupPrimitive.Indicator asChild>
        <motion.span
          aria-hidden="true"
          data-slot="segmented-control-indicator"
          layoutId={indicatorId}
          transition={reduceMotion ? { duration: 0 } : INDICATOR_TRANSITION}
          // The radius is an INLINE style, not `rounded-md`, and that is not a
          // style-guide slip. A layout animation changes the pill's size with
          // scaleX/scaleY, which stretches corner radii into ellipses for the
          // duration of the slide — and segments genuinely differ in width, so
          // it always scales. framer-motion counter-scales the radius per
          // frame to keep corners circular, but only when it can read a
          // numeric radius off `style`; it cannot parse it out of a class.
          // Keep this in step with `--radius-md` (6px), which is what
          // `rounded-md` resolves to.
          style={{ borderRadius: 6 }}
          className="absolute inset-0 z-0 bg-sidebar shadow-sm"
        />
      </RadioGroupPrimitive.Indicator>

      {/* The icon sits OUTSIDE the label's width-reservation grid below: it does
          not change size with font weight, so duplicating it would only cost a
          second render. `z-10` for the same reason the label needs it. */}
      {icon ? (
        <span
          aria-hidden="true"
          data-slot="segmented-control-item-icon"
          className="relative z-10 inline-flex shrink-0 items-center justify-center"
        >
          {icon}
        </span>
      ) : null}

      {/* `z-10` here is load-bearing, not decoration. Mid-slide the pill lives
          in the DESTINATION item's subtree while transformed back over the
          segments it is travelling across — and since items are `relative`
          with `z-index: auto` they do not open stacking contexts, so every
          label's `z-10` and every pill's `z-0` resolve against the same
          ancestor. That is what keeps all labels painted above the pill
          instead of the pill blanking out each label it passes.
          (`opacity` below 1 DOES open a stacking context, so a disabled
          segment mid-track is the one case the pill can still cross over.)

          The checked label is semibold while the others are medium, and a
          heavier label is a WIDER label — left alone, selecting a segment
          would resize it, reflow every sibling, and leave the sliding pill
          chasing a target that moves under it. So each item permanently
          reserves its own semibold width: an invisible bold copy sets the
          column, the real label sits centred in the same grid cell, and the
          geometry never changes. Labels must therefore stay render-safe to
          duplicate — plain text or an icon, nothing stateful. */}
      <span className="relative z-10 grid min-w-0 justify-items-center">
        <span
          aria-hidden="true"
          className="invisible col-start-1 row-start-1 truncate font-semibold"
        >
          {children}
        </span>
        <span className="col-start-1 row-start-1 truncate">{children}</span>
      </span>
    </RadioGroupPrimitive.Item>
  )
})
SegmentedControlItem.displayName = 'SegmentedControlItem'

export { trackVariants as segmentedControlTrackVariants, itemVariants as segmentedControlItemVariants }
