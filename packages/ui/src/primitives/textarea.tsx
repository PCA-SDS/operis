"use client"

import * as React from 'react'

import { cn } from '@open-mercato/shared/lib/utils'

/* Matches the `Input` field treatment exactly — same border, same hover/focus
   fill, same weight split between value and placeholder — so a form does not
   read as two different control families stacked on top of each other. */
const baseTextareaClass =
  'flex w-full rounded-lg border border-input bg-input-bg px-3 py-2 text-sm font-medium transition-colors placeholder:font-normal placeholder:text-input-placeholder outline-none focus-visible:outline-none focus-visible:shadow-focus focus-visible:border-input-border-focus focus-visible:bg-modal-muted hover:bg-modal-muted disabled:cursor-not-allowed disabled:bg-input-disabled-bg disabled:text-text-disabled disabled:border-border-disabled disabled:shadow-none disabled:hover:bg-input-disabled-bg aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:border-destructive resize-y min-h-20'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Show character counter (`current/max`) below the textarea. Requires `maxLength`. */
  showCount?: boolean
  /** Optional className applied to the outer wrapper (when counter is shown). */
  wrapperClassName?: string
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, showCount, wrapperClassName, value, defaultValue, maxLength, onChange, ...props }, ref) => {
    const [internalValue, setInternalValue] = React.useState<string>(
      typeof defaultValue === 'string' ? defaultValue : typeof value === 'string' ? value : ''
    )

    const isControlled = value !== undefined
    const currentValue = isControlled ? String(value ?? '') : internalValue

    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (!isControlled) setInternalValue(event.target.value)
        onChange?.(event)
      },
      [isControlled, onChange]
    )

    const textarea = (
      <textarea
        ref={ref}
        value={value}
        defaultValue={isControlled ? undefined : defaultValue}
        maxLength={maxLength}
        onChange={handleChange}
        className={cn(baseTextareaClass, className)}
        {...props}
      />
    )

    if (!showCount) return textarea

    const length = currentValue.length
    const max = typeof maxLength === 'number' ? maxLength : undefined
    const isError = max != null && length > max
    const isDisabled = props.disabled

    return (
      <div className={cn('flex flex-col gap-1', wrapperClassName)}>
        {textarea}
        <div className="flex justify-end">
          <span
            className={cn(
              'text-overline uppercase',
              isDisabled
                ? 'text-text-disabled'
                : isError
                  ? 'text-destructive'
                  : 'text-muted-foreground'
            )}
            aria-live="polite"
          >
            {max != null ? `${length}/${max}` : `${length}`}
          </span>
        </div>
      </div>
    )
  }
)

Textarea.displayName = 'Textarea'
