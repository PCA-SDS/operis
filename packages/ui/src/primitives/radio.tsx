"use client"

import * as React from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'

import { cn } from '@open-mercato/shared/lib/utils'

export const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root
    ref={ref}
    className={cn('flex flex-col gap-2', className)}
    {...props}
  />
))
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName

export const Radio = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      'aspect-square size-5 shrink-0 rounded-full border border-input bg-input-bg',
      'flex items-center justify-center transition-colors',
      'hover:border-primary/50',
      /* Checked fill is `--primary`, in step with Checkbox and Switch. */
      'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
      'focus-visible:outline-none focus-visible:shadow-focus',
      'disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-bg-disabled',
      className
    )}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
      <span aria-hidden="true" className="block size-2 rounded-full bg-primary-foreground" />
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
))
Radio.displayName = RadioGroupPrimitive.Item.displayName
