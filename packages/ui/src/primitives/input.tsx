import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'

/* A field is a bordered box on `input-bg` that warms to `modal-muted` on hover
   and on focus. Focus moves the border to the primary hue and adds the shared
   quiet halo — the two together mean an engaged field is obvious without a
   heavy ring. Radius is `lg` to match the default control height (h-9). */
const inputWrapperVariants = cva(
  'inline-flex w-full items-center gap-2 rounded-lg border border-input bg-input-bg transition-colors focus-within:outline-none focus-within:shadow-focus focus-within:border-input-border-focus focus-within:bg-modal-muted hover:bg-modal-muted has-[input:disabled]:bg-input-disabled-bg has-[input:disabled]:border-border-disabled has-[input:disabled]:shadow-none has-[input:disabled]:hover:bg-input-disabled-bg has-[input[aria-invalid=true]]:border-destructive',
  {
    variants: {
      size: {
        sm: 'h-8 rounded-md px-2.5',
        default: 'h-9 px-3',
        lg: 'h-10 px-3.5',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
)

/* The value is `font-medium`, the placeholder is `font-normal` — so an empty
   field reads as a prompt and a filled one reads as data, before colour. */
const inputElementVariants = cva(
  'flex-1 min-w-0 bg-transparent border-0 outline-none font-medium placeholder:font-normal placeholder:text-input-placeholder disabled:cursor-not-allowed disabled:bg-transparent disabled:text-text-disabled',
  {
    variants: {
      size: {
        sm: 'text-xs',
        default: 'text-sm',
        lg: 'text-sm',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
)

export type InputProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'size'> &
  VariantProps<typeof inputWrapperVariants> & {
    leftIcon?: React.ReactNode
    rightIcon?: React.ReactNode
    /** Optional className on the inner <input> element. */
    inputClassName?: string
  }

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, inputClassName, type = 'text', size, leftIcon, rightIcon, ...props }, ref) => {
    return (
      <div
        className={cn(inputWrapperVariants({ size }), className)}
        data-slot="input-wrapper"
      >
        {leftIcon ? (
          <span
            className="flex shrink-0 items-center text-muted-foreground [&_svg]:size-4"
            aria-hidden="true"
          >
            {leftIcon}
          </span>
        ) : null}
        <input
          ref={ref}
          type={type}
          className={cn(inputElementVariants({ size }), inputClassName)}
          {...props}
        />
        {rightIcon ? (
          <span
            className="flex shrink-0 items-center text-muted-foreground [&_svg]:size-4"
            aria-hidden="true"
          >
            {rightIcon}
          </span>
        ) : null}
      </div>
    )
  }
)

Input.displayName = 'Input'

export { inputWrapperVariants, inputElementVariants }
