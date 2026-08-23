import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'

/* Radius grows with size — a compact button takes `rounded-md`, the default and
   large sizes take `rounded-lg`. A single radius across the scale makes small
   buttons look chunky and large ones look sharp. */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium cursor-pointer transition-colors disabled:pointer-events-none disabled:bg-bg-disabled disabled:text-text-disabled disabled:border-border-disabled disabled:shadow-none disabled:[background-image:none] [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:outline-none focus-visible:shadow-focus aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          'border border-transparent bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active',
        /* Destructive is quiet by design: red text on a calm surface. A wall
           of solid red buttons trains users to ignore red. The filled form is
           `destructive-solid`, reserved for the single point-of-no-return
           confirmation inside a dialog — never for the button that opens it. */
        destructive:
          'border border-destructive/40 bg-surface text-destructive shadow-sm hover:bg-status-error-bg aria-invalid:ring-destructive dark:aria-invalid:ring-destructive',
        'destructive-solid':
          'border border-transparent bg-destructive text-white hover:bg-status-error-solid aria-invalid:ring-destructive dark:aria-invalid:ring-destructive',
        'destructive-outline':
          'border border-destructive/40 bg-surface text-destructive shadow-sm hover:bg-status-error-bg',
        'destructive-soft':
          'border border-transparent bg-status-error-bg text-destructive hover:bg-status-error-border/50',
        'destructive-ghost':
          'border border-transparent text-destructive hover:bg-status-error-bg',
        /* `outline` and `secondary` are the same second-rank action: a surface
           card with a hairline and a whisper of lift. They are kept as separate
           names because call sites use both, not because they differ. */
        outline:
          'border border-border bg-surface text-foreground shadow-sm hover:bg-surface-muted',
        secondary:
          'border border-border bg-surface text-foreground shadow-sm hover:bg-surface-muted',
        /* Quiet chrome action — no fill or border at rest, `surface-strong` on
           hover so it reads as chrome rather than as an accent tint. */
        ghost:
          'border border-transparent text-muted-foreground hover:bg-surface-strong hover:text-foreground',
        muted:
          'border border-transparent text-muted-foreground hover:bg-surface-strong hover:text-foreground',
        link: 'text-accent-strong underline-offset-4 hover:underline hover:text-accent-strong-hover',
      },
      size: {
        default: 'h-9 rounded-lg px-3.5 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-11 rounded-lg px-4 py-3 has-[>svg]:px-4',
        '2xs': 'h-7 gap-1 rounded-md px-2.5 py-0.5 has-[>svg]:px-1.5 text-xs',
        icon: 'size-9 rounded-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { buttonVariants }

