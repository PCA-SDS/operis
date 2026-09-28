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
 * **One look, everywhere.** Every switcher in the product is drawn the same
 * way, on a page, in a toolbar or in a dialog: the selected segment is the
 * near-black pill (the sidebar family) with light ink, filling the track edge to
 * edge, so it stands exactly as tall as a `Button` or field of the same size;
 * the unselected segments are near-black text with a quiet fill on hover. Two
 * looks (a black pill on the page, a white pill inset on grey in dialogs) read
 * as two different controls.
 *
 * **Tone picks the rail, nothing else.** `default` is the rail for the page
 * ground and `inset` the field well for a raised surface (a card, a dialog, a
 * popover). In light both are the grey control fill, since a white rail
 * vanished once the ground turned white; in dark the ground's rail is the
 * raised surface, so the raised-grey pill stands off it, and the well steps
 * off a card. Inside a grey form section both turn white with the fields
 * (`globals.css`). The pill and the labels do not change.
 *
 * **Geometry.** The track owns the height; items stretch to it rather than
 * carrying their own. `flush` (the default) lets the pill fill the track.
 * `flush={false}` brings back a pill inset 4px (2px at `sm`) inside a bordered
 * rail; nothing in the product uses it.
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
  /** See the `flush` variant — the pill's radius follows it. */
  flush: boolean
  disabled?: boolean
  /** Scopes the sliding pill to this control — see `indicatorId` below. */
  indicatorId: string
}

const SegmentedControlContext = React.createContext<SegmentedControlContextValue>({
  size: 'default',
  fullWidth: false,
  flush: true,
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

/** The pill's corner radius, inline for the reason given at the indicator, so
 *  keep it in step with the radius tokens by hand. Inset, the pill sits a notch
 *  inside the track's `rounded-lg`; flush, it IS the track's edge and takes
 *  `--radius-lg` (10px) itself. */
const INDICATOR_RADIUS = { inset: 6, flush: 10 } as const

const trackVariants = cva(
  // One rail holding one filled item. `items-stretch` is load-bearing: items
  // derive their height from the track's content box, so a flush pill fills the
  // track and an inset one sits the track's padding in from it on every side.
  //   flush   → the pill is the track's full height, 36px (32px at `sm`)
  //   inset   → h-9 (36px) − 2px border − 8px padding = 26px item, 4px all round
  'items-stretch gap-0 rounded-lg transition-colors',
  {
    variants: {
      /**
       * The rail only; the pill and the labels are the same in both.
       *
       * `default` — the page ground's rail (`--segmented-rail`).
       *
       * `inset` — the field well, for a card, a dialog or a popover, where in
       * dark the ground's rail would match the surface.
       */
      tone: {
        default: 'border border-transparent bg-segmented-rail',
        inset: 'border border-transparent bg-input-bg',
      },
      size: {
        sm: 'h-8 p-0.5',
        default: 'h-9 p-1',
      },
      // Declared after `size` on purpose: `cn()` keeps the later of two
      // conflicting utilities, so `p-0` and `border-0` here win over the size's
      // inset and the tone's border.
      flush: {
        true: 'border-0 p-0',
        false: '',
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
      tone: 'default',
      size: 'default',
      flush: true,
      fullWidth: false,
      disabled: false,
    },
  },
)

const itemVariants = cva(
  // The SELECTED item is the near-black pill plus a soft lift, painted by the
  // sliding pill rather than by a class on the item, so only the text treatment
  // lives here. Selected ink is the sidebar's own foreground, legible on the
  // pill. Unselected labels are full ink, like every other control's label, and
  // a hover lays a quiet fill over the segment, so the one filled item stays the
  // whole signal.
  //
  // `relative` is load-bearing: the pill is positioned against the item.
  // The 200ms colour window matches the pill's travel so ink and fill land
  // together; `motion-reduce` drops it via CSS (not `useReducedMotion`) because
  // this class is emitted during SSR.
  'relative inline-flex items-center justify-center rounded-md font-medium ' +
    'transition-colors duration-200 motion-reduce:transition-none ' +
    'outline-none focus-visible:shadow-focus ' +
    'disabled:cursor-not-allowed disabled:opacity-50 ' +
    'data-[state=checked]:font-semibold data-[state=checked]:text-sidebar-foreground ' +
    'data-[state=unchecked]:bg-transparent data-[state=unchecked]:text-foreground data-[state=unchecked]:hover:bg-foreground/5',
  {
    variants: {
      size: {
        sm: 'gap-1.5 px-2 text-xs',
        default: 'gap-2 px-3 text-sm',
      },
      fullWidth: {
        // `basis-0` (not just `flex-1`) makes every segment an equal share of the
        // track instead of a share weighted by label length.
        true: 'min-w-0 flex-1 basis-0',
        false: '',
      },
      // A flush item fills the track, so it (and the focus ring drawn on it)
      // takes the track's radius rather than the inset pill's.
      flush: {
        true: 'rounded-lg',
        false: '',
      },
    },
    defaultVariants: {
      size: 'default',
      fullWidth: false,
      flush: true,
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
>(({ className, size, tone, fullWidth, flush, disabled, children, ...props }, ref) => {
  // The sliding pill is a shared layout element keyed by `layoutId`. That key
  // is global to framer-motion, so two segmented controls on one page sharing
  // a key would animate their pills into each other across the screen. A
  // per-instance id keeps each control's pill to itself.
  const instanceId = React.useId()
  const ctx = React.useMemo<SegmentedControlContextValue>(
    () => ({
      size: size ?? 'default',
      fullWidth: fullWidth ?? false,
      flush: flush ?? true,
      disabled: disabled ?? false,
      indicatorId: `segmented-control-indicator-${instanceId}`,
    }),
    [size, fullWidth, flush, disabled, instanceId],
  )
  return (
    <SegmentedControlContext.Provider value={ctx}>
      <RadioGroupPrimitive.Root
        ref={ref}
        orientation="horizontal"
        disabled={disabled ?? undefined}
        data-slot="segmented-control"
        className={cn(trackVariants({ size, tone, fullWidth, flush, disabled }), className)}
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
    flush,
    disabled: groupDisabled,
    indicatorId,
  } = React.useContext(SegmentedControlContext)
  const reduceMotion = useReducedMotion()

  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      data-slot="segmented-control-item"
      className={cn(
        itemVariants({ size, fullWidth, flush }),
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
          style={{ borderRadius: flush ? INDICATOR_RADIUS.flush : INDICATOR_RADIUS.inset }}
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
