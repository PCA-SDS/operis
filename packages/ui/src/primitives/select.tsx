"use client"

import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'
import { MENU_ROW_SPACING } from './menu'

/* The trigger is a field, so it carries the same chrome as `Input` — matching
   border, hover/focus fill, and the value/placeholder weight split. */
const selectTriggerVariants = cva(
  'inline-flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-input-bg font-medium transition-colors outline-none hover:bg-modal-muted focus:outline-none focus-visible:outline-none focus-visible:shadow-focus focus-visible:border-input-border-focus disabled:cursor-not-allowed disabled:bg-input-disabled-bg disabled:text-text-disabled disabled:border-border-disabled disabled:shadow-none disabled:hover:bg-input-disabled-bg disabled:[&_svg]:opacity-60 aria-[invalid=true]:border-destructive data-[placeholder]:font-normal data-[placeholder]:text-input-placeholder [&>span]:line-clamp-1 [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      size: {
        xs: 'h-7 rounded-md px-2 text-xs',
        sm: 'h-8 rounded-md px-2.5 text-xs',
        default: 'h-9 px-3 text-sm',
        lg: 'h-10 px-3.5 text-sm',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
)

export type SelectTriggerProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> &
  VariantProps<typeof selectTriggerVariants>

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(({ className, size, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(selectTriggerVariants({ size }), className)}
    data-slot="select-trigger"
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="text-muted-foreground" aria-hidden="true" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

/**
 * Leading visual slot inside a `SelectTrigger` — render flags, avatars,
 * provider logos, brand marks, or company icons before the `<SelectValue>`.
 *
 * Mirrors the Type variants in the Figma DS (Basic / Country / Avatar /
 * Provider / Brand / Company — Figma `Select [1.1]`, node `270:1085`).
 *
 * Render inside `SelectTrigger`, BEFORE the `<SelectValue>`:
 *
 * ```tsx
 * <SelectTrigger>
 *   <SelectTriggerLeading><Avatar size="sm" label={user.name} /></SelectTriggerLeading>
 *   <SelectValue placeholder="Select user" />
 * </SelectTrigger>
 * ```
 *
 * Sizing follows the trigger: icons render `size-4`, images render `size-5`
 * by default — pass your own classes on the inner element when you need a
 * different visual size (e.g. country flags `h-3 w-4`).
 */
const SelectTriggerLeading = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, children, ...props }, ref) => (
  <span
    ref={ref}
    data-slot="select-trigger-leading"
    aria-hidden="true"
    className={cn(
      'flex shrink-0 items-center justify-center',
      '[&>svg]:size-4 [&>svg]:shrink-0 [&>img]:size-5 [&>img]:shrink-0',
      className
    )}
    {...props}
  >
    {children}
  </span>
))
SelectTriggerLeading.displayName = 'SelectTriggerLeading'

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1 text-muted-foreground', className)}
    {...props}
  >
    <ChevronUp className="size-4" aria-hidden="true" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1 text-muted-foreground', className)}
    {...props}
  >
    <ChevronDown className="size-4" aria-hidden="true" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName

export type SelectContentProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content> & {
  viewportProps?: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Viewport>
}

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  SelectContentProps
>(({ className, children, position = 'popper', sideOffset = 4, viewportProps, ...props }, ref) => {
  const { className: viewportClassName, ...restViewportProps } = viewportProps ?? {}

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        sideOffset={sideOffset}
        className={cn(
          'relative z-popover min-w-[8rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]',
          className
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            'p-2 max-h-[var(--radix-select-content-available-height)] overflow-y-auto',
            position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]',
            viewportClassName,
          )}
          {...restViewportProps}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
})
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn(
      'px-3 pt-2 pb-1 text-overline font-semibold uppercase tracking-wider text-disabled-foreground',
      'select-none',
      className
    )}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-3 py-2 text-sm outline-none transition-colors',
      MENU_ROW_SPACING,
      'focus:bg-surface-muted focus:text-foreground',
      'data-[state=checked]:bg-primary-soft data-[state=checked]:font-medium data-[state=checked]:text-foreground',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      '[&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-4 [&_svg]:shrink-0',
      className
    )}
    {...props}
  >
    <SelectPrimitive.ItemText asChild>
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
        {children}
      </span>
    </SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="ml-auto flex shrink-0 items-center justify-center">
      <Check className="size-4 text-accent-strong" aria-hidden="true" />
    </SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

/**
 * Leading visual slot inside a `SelectItem` — mirror of `SelectTriggerLeading`
 * for dropdown rows. Compose with the DS `Avatar`, country flag images, or
 * `lucide-react` icons.
 *
 * Render inside the `<SelectItem>` children, before the row label:
 *
 * ```tsx
 * <SelectItem value="us">
 *   <SelectItemLeading><span className="h-3 w-4 rounded-sm overflow-hidden">🇺🇸</span></SelectItemLeading>
 *   United States
 * </SelectItem>
 * ```
 *
 * NOTE: `SelectPrimitive.ItemText` only reads the text node siblings for the
 * trigger preview — wrap the leading slot OUTSIDE `ItemText` (which this
 * primitive does by default, since `SelectItem`'s `children` are placed inside
 * `<SelectPrimitive.ItemText>` only via the inner `<span className="flex-1
 * truncate">`). Place the `SelectItemLeading` alongside the row text and the
 * label will read correctly in the trigger preview.
 */
const SelectItemLeading = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, children, ...props }, ref) => (
  <span
    ref={ref}
    data-slot="select-item-leading"
    aria-hidden="true"
    className={cn(
      'flex shrink-0 items-center justify-center',
      '[&>svg]:size-4 [&>svg]:shrink-0 [&>img]:size-5 [&>img]:shrink-0',
      className
    )}
    {...props}
  >
    {children}
  </span>
))
SelectItemLeading.displayName = 'SelectItemLeading'

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-border', className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

/**
 * Wraps Radix `Select.Root` to absorb the controlled/uncontrolled transition
 * many call sites trigger by passing `value={x || undefined}`. React fires
 * "Select is changing from uncontrolled to controlled" the moment value flips
 * from undefined to a defined string, and Radix's internal state ends up in
 * an inconsistent shape (dropdown flashes, selections no-op). Coercing
 * `undefined` → `''` keeps Radix in stable controlled mode for the lifetime
 * of the component while preserving "no selection" semantics — Radix simply
 * matches no SelectItem and `SelectValue` falls back to the placeholder.
 */
const Select = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root>
>(({ value, defaultValue, onValueChange, ...props }, _ref) => {
  const isControlled = value !== undefined || onValueChange !== undefined
  if (!isControlled) {
    return <SelectPrimitive.Root defaultValue={defaultValue} {...props} />
  }
  return (
    <SelectPrimitive.Root
      value={value ?? ''}
      onValueChange={onValueChange}
      {...props}
    />
  )
}) as unknown as typeof SelectPrimitive.Root
;(Select as React.ComponentType).displayName = 'Select'
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectTriggerLeading,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectItemLeading,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
  selectTriggerVariants,
}
