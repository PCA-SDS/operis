import * as React from 'react'
import { X } from 'lucide-react'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * The one close affordance for dismissible chrome — dialogs, drawers, side
 * panels. A quiet `X` in the secondary grey that, on hover, darkens to
 * `foreground` on a soft round fill — the close control of an Apple sheet. It
 * never scales: motion explains a change, it does not decorate a hover.
 *
 * The box is a fixed `h-* w-*`, not padding-derived, so a Close placed beside
 * another icon affordance takes the same `size` and the pair matches at rest
 * and on hover.
 */

export type CloseButtonSize = 'sm' | 'md' | 'lg'

const SIZE_CLASSES: Record<CloseButtonSize, { button: string; icon: string }> = {
  sm: { button: 'h-6 w-6', icon: 'size-3.5' },
  md: { button: 'h-7 w-7', icon: 'size-4' },
  /* `lg` grew the box but kept `md`'s glyph, so asking for the large close
     bought a wider hit target and a mark that looked identical — the ladder
     read 3.5 / 4 / 4. `size-5` makes the third step an actual step. No call
     site was affected: every one of the 14 uses took the `md` default, so
     this size had never rendered. */
  lg: { button: 'h-8 w-8', icon: 'size-5' },
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
          'inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150',
          'hover:bg-surface-muted hover:text-foreground active:bg-surface-strong',
          'focus-visible:outline-none focus-visible:shadow-focus',
          'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent',
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
