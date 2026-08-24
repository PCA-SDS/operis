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
 * Use for **mutually-exclusive view state** — list page filters like
 * "All / Active / Archived", chart period selectors, layout toggles
 * (List / Grid). For *related actions* (each does something different),
 * reach for `ButtonGroup` instead.
 *
 * Built on Radix `RadioGroup` so we inherit the radio-group ARIA contract
 * (`role="radiogroup"`, `role="radio"` on items, arrow-key navigation,
 * roving tabindex) for free. No new dependency — Radix RadioGroup is
 * already installed via the `Radio` primitive.
 *
 * **Motion.** The selected fill is a single shared element that slides
 * between segments rather than a class that blinks on and off, so the
 * control reads as one pill moving along a rail. It is driven by
 * framer-motion's shared-layout transition: the pill renders inside the
 * checked item, and when the selection moves, framer-motion measures both
 * positions and animates between them. Because it is a real layout
 * animation it stays correct when segment widths differ, when labels are
 * translated, and when the container resizes — no measurement code, no
 * `ResizeObserver`, nothing to keep in sync.
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
  disabled?: boolean
  /** Scopes the sliding pill to this control — see `indicatorId` below. */
  indicatorId: string
}

const SegmentedControlContext = React.createContext<SegmentedControlContextValue>({
  size: 'default',
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
  // Height math (box-border on every element):
  //   default → track h-9 (36px) − 2px border − 4px padding (p-0.5 ×2) = 30px → item h-7 (28px) + 2px slack
  //   sm      → track h-8 (32px) − 2px border − 4px padding (p-0.5 ×2) = 26px → item h-6 (24px) + 2px slack
  // The 2px slack is deliberate: it keeps the filled item clear of the track
  // border on both edges instead of clipping against it.
  'inline-flex w-fit items-center gap-0 rounded-lg border border-border bg-surface p-0.5 transition-colors',
  {
    variants: {
      size: {
        sm: 'h-8',
        default: 'h-9',
      },
      disabled: {
        true: 'cursor-not-allowed opacity-60',
        false: '',
      },
    },
    defaultVariants: {
      size: 'default',
      disabled: false,
    },
  },
)

const itemVariants = cva(
  // The track is a bordered `surface` rail; the SELECTED item is the quiet fill
  // plus a hairline lift — both painted by the sliding pill, not by a class on
  // the item, so only the text treatment lives here. Unselected text is muted
  // and hover only nudges colour, so the rail stays flat and the single filled
  // item is the whole signal.
  //
  // `relative` is load-bearing: the pill is positioned against the item.
  'relative inline-flex items-center justify-center rounded-md font-medium ' +
    'transition-colors outline-none focus-visible:shadow-focus ' +
    'disabled:cursor-not-allowed disabled:opacity-50 ' +
    'data-[state=checked]:text-foreground data-[state=checked]:font-semibold ' +
    'data-[state=unchecked]:bg-transparent data-[state=unchecked]:text-muted-foreground data-[state=unchecked]:hover:text-foreground',
  {
    variants: {
      size: {
        sm: 'h-6 px-2.5 text-xs',
        default: 'h-7 px-3 text-sm',
      },
    },
    defaultVariants: {
      size: 'default',
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
>(({ className, size, disabled, children, ...props }, ref) => {
  // The sliding pill is a shared layout element keyed by `layoutId`. That key
  // is global to framer-motion, so two segmented controls on one page sharing
  // a key would animate their pills into each other across the screen. A
  // per-instance id keeps each control's pill to itself.
  const instanceId = React.useId()
  const ctx = React.useMemo<SegmentedControlContextValue>(
    () => ({
      size: size ?? 'default',
      disabled: disabled ?? false,
      indicatorId: `segmented-control-indicator-${instanceId}`,
    }),
    [size, disabled, instanceId],
  )
  return (
    <SegmentedControlContext.Provider value={ctx}>
      <RadioGroupPrimitive.Root
        ref={ref}
        orientation="horizontal"
        disabled={disabled ?? undefined}
        data-slot="segmented-control"
        className={cn(trackVariants({ size, disabled }), className)}
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
>

export const SegmentedControlItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  SegmentedControlItemProps
>(({ className, children, ...props }, ref) => {
  const { size, disabled: groupDisabled, indicatorId } = React.useContext(SegmentedControlContext)
  const reduceMotion = useReducedMotion()

  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      data-slot="segmented-control-item"
      className={cn(
        itemVariants({ size }),
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
          className="absolute inset-0 z-0 bg-surface-muted shadow-sm"
        />
      </RadioGroupPrimitive.Indicator>

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
      <span className="relative z-10 grid justify-items-center">
        <span
          aria-hidden="true"
          className="invisible col-start-1 row-start-1 whitespace-nowrap font-semibold"
        >
          {children}
        </span>
        <span className="col-start-1 row-start-1 whitespace-nowrap">{children}</span>
      </span>
    </RadioGroupPrimitive.Item>
  )
})
SegmentedControlItem.displayName = 'SegmentedControlItem'

export { trackVariants as segmentedControlTrackVariants, itemVariants as segmentedControlItemVariants }
