"use client"

import * as React from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { cva, type VariantProps } from 'class-variance-authority'

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
}

const SegmentedControlContext = React.createContext<SegmentedControlContextValue>({
  size: 'default',
  disabled: false,
})

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
  // plus a hairline lift. Unselected text is muted and hover only nudges colour,
  // so the rail stays flat and the single filled item is the whole signal.
  'inline-flex items-center justify-center rounded-md font-medium ' +
    'transition-all outline-none focus-visible:shadow-focus ' +
    'disabled:cursor-not-allowed disabled:opacity-50 ' +
    'data-[state=checked]:bg-surface-muted data-[state=checked]:text-foreground data-[state=checked]:font-semibold data-[state=checked]:shadow-sm ' +
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
  const ctx = React.useMemo<SegmentedControlContextValue>(
    () => ({ size: size ?? 'default', disabled: disabled ?? false }),
    [size, disabled],
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
  const { size } = React.useContext(SegmentedControlContext)
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      data-slot="segmented-control-item"
      className={cn(itemVariants({ size }), className)}
      {...props}
    >
      {children}
    </RadioGroupPrimitive.Item>
  )
})
SegmentedControlItem.displayName = 'SegmentedControlItem'

export { trackVariants as segmentedControlTrackVariants, itemVariants as segmentedControlItemVariants }
