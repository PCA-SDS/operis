import * as React from 'react'
import { X } from 'lucide-react'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * The one close affordance for dismissible chrome — dialogs, drawers, side
 * panels. The close control of an Apple sheet: a filled grey circle holding a
 * small secondary-grey mark, the same control fill and hover step as a grey
 * `Button`, so it reads as a control at rest rather than appearing on hover.
 * It never scales: motion explains a change, it does not decorate a hover.
 *
 * The box is a fixed `h-* w-*`, not padding-derived, so a Close placed beside
 * another icon affordance takes the same `size` and the pair matches at rest
 * and on hover. The mark is half the box, as in Apple's filled close.
 */

export type CloseButtonSize = 'sm' | 'md' | 'lg'

const SIZE_CLASSES: Record<CloseButtonSize, { button: string; icon: string }> = {
  sm: { button: 'h-6 w-6', icon: 'size-3' },
  md: { button: 'h-7 w-7', icon: 'size-3.5' },
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
          'inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft text-muted-foreground transition-colors duration-150',
          'hover:bg-primary-border/60 hover:text-foreground active:bg-primary-border',
          'focus-visible:outline-none focus-visible:shadow-focus',
          'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-primary-soft',
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
