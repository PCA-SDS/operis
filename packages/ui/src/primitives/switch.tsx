"use client"

import * as React from 'react'

import { cn } from '@open-mercato/shared/lib/utils'

type SwitchProps = {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
} & Omit<React.ComponentProps<'button'>, 'onChange'>

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, defaultChecked, onCheckedChange, disabled, className, onClick, onKeyDown, ...props }, ref) => {
    const isControlled = typeof checked === 'boolean'
    const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultChecked ?? false)

    const currentChecked = isControlled ? checked : uncontrolledValue

    const toggle = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>) => {
        event.preventDefault()
        if (disabled) {
          return
        }
        const next = !currentChecked
        if (!isControlled) {
          setUncontrolledValue(next)
        }
        onCheckedChange?.(next)
      },
      [currentChecked, disabled, isControlled, onCheckedChange]
    )

    const handleClick = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (!event.defaultPrevented) {
          toggle(event)
        }
      },
      [onClick, toggle]
    )

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLButtonElement>) => {
        onKeyDown?.(event)
        if (event.defaultPrevented) {
          return
        }
        if (event.key === ' ' || event.key === 'Enter') {
          toggle(event)
        }
      },
      [onKeyDown, toggle]
    )

    return (
      <button
        type="button"
        role="switch"
        aria-checked={currentChecked}
        aria-disabled={disabled}
        data-state={currentChecked ? 'checked' : 'unchecked'}
        data-disabled={disabled ? '' : undefined}
        ref={ref}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={cn(
          'group relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent p-0',
          'focus-visible:outline-none focus-visible:shadow-focus',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className
        )}
        {...props}
      >
        {/* Track. Off is the chrome step (`surface-strong` + hairline), not a
            grey slab, so an unset preference reads as neutral rather than as
            something switched off in anger. On is `--primary`, in step with
            Checkbox and Radio. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none flex h-5 w-9 items-center rounded-full border px-0.5 transition-colors duration-200',
            'border-border bg-surface-strong group-hover:bg-border',
            'group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary group-data-[state=checked]:group-hover:bg-primary-hover'
          )}
        >
          <span
            className={cn(
              'block size-4 rounded-full bg-white transition-transform duration-200 shadow-switch-thumb',
              currentChecked ? 'translate-x-4' : 'translate-x-0'
            )}
          />
        </span>
      </button>
    )
  }
)

Switch.displayName = 'Switch'
