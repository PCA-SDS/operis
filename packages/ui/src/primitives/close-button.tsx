import * as React from 'react'
import { X } from 'lucide-react'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * The one close affordance for dismissible chrome — dialogs, drawers, side
 * panels. A disabled-foreground `X` that scales 1.25x and recolours to
 * `foreground` on hover over 300ms.
 *
 * The box is a fixed `h-* w-*`, not padding-derived, so a Close placed beside
 * another icon affordance takes the same `size` and the pair matches at rest
 * and under the shared hover scale.
 */

export type CloseButtonSize = 'sm' | 'md' | 'lg'

const SIZE_CLASSES: Record<CloseButtonSize, { button: string; icon: string }> = {
  sm: { button: 'h-6 w-6', icon: 'size-3.5' },
  md: { button: 'h-7 w-7', icon: 'size-4' },
  lg: { button: 'h-8 w-8', icon: 'size-4' },
}

export type CloseButtonProps = Omit<
  React.ComponentPropsWithoutRef<'button'>,
  'type' | 'children'
> & {
  size?: CloseButtonSize
}

export const CloseButton = React.forwardRef<HTMLButtonElement, CloseButtonProps>(
  ({ size = 'md', className, 'aria-label': ariaLabel, ...props }, ref) => {
    const { button, icon } = SIZE_CLASSES[size]
    return (
      <button
        ref={ref}
        type="button"
        data-slot="close-button"
        aria-label={ariaLabel ?? 'Close'}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md text-disabled-foreground transition-all duration-300',
          'hover:scale-125 hover:text-foreground',
          'focus-visible:outline-none focus-visible:shadow-focus',
          'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100',
          button,
          className,
        )}
        {...props}
      >
        <X className={icon} aria-hidden="true" />
      </button>
    )
  },
)
CloseButton.displayName = 'CloseButton'
