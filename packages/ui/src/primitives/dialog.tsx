"use client"

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CloseButton } from './close-button'

/**
 * Modal dialog primitive. Chrome follows the canonical borderless scheme:
 * a `rounded-2xl bg-surface shadow-xl` panel on a `bg-foreground/40` overlay,
 * with the vertical rhythm carried entirely by the padding trio —
 * header `px-5 py-4 sm:px-6`, body `px-5 pt-3 pb-5 sm:px-6`, footer
 * `px-5 pt-1.5 pb-4 sm:px-6` — and NO divider under the header or above the
 * footer. Don't reintroduce chrome dividers. Content-level hairlines (table
 * rows, card caption strips) are not chrome and are fine.
 *
 * Body padding is slot-owned, so `DialogContent` groups any children that
 * aren't a Header/Footer/Body into a `DialogBody` automatically. Wrap content
 * in an explicit `<DialogBody>` when you need to pass it a className, or set
 * `disableBodyWrap` to lay the panel out by hand.
 *
 * Additive props beyond the Radix contract:
 *   DialogContent: `size` ('sm' | 'default' | 'lg' | 'xl'), `dismissible`,
 *     `elevated`, `disableBodyWrap`
 *   DialogHeader:  `leading` icon badge, `leadingTone`
 *   DialogFooter:  `layout` ('default' | 'equal'), `leading` slot, `bordered`
 *     (opt-in rule — off by default per the borderless chrome above)
 */

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & {
    /** Render above popovers (z-modal-elevated, 55) instead of the default z-modal (40).
     *  Use when this dialog is opened from inside a popover so it isn't occluded. */
    elevated?: boolean
  }
>(({ className, elevated, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-slot="dialog-overlay"
    className={cn(
      'fixed inset-0 bg-foreground/40 animate-fadeIn transition-opacity data-[state=closed]:animate-out',
      elevated ? 'z-modal-elevated' : 'z-modal',
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const dialogContentVariants = cva(
  'fixed inset-x-0 bottom-0 flex max-h-[92dvh] w-full translate-x-0 translate-y-0 flex-col overflow-y-auto rounded-t-2xl bg-surface shadow-xl animate-fadeInUp sm:inset-auto sm:left-1/2 sm:top-1/2 sm:min-h-0 sm:h-auto sm:w-full sm:max-h-[calc(100dvh-4rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl focus-visible:outline-none data-[state=closed]:animate-out',
  {
    variants: {
      size: {
        sm: 'sm:max-w-sm',
        default: 'sm:max-w-lg',
        lg: 'sm:max-w-2xl',
        xl: 'sm:max-w-4xl',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
)

/** Lets DialogHeader reserve the close-button gutter only when one renders. */
const DialogChromeContext = React.createContext<{ dismissible: boolean }>({
  dismissible: false,
})

export type DialogContentProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> &
  VariantProps<typeof dialogContentVariants> & {
    /** Render above popovers (z-modal-elevated, 55) instead of the default z-modal (40).
     *  Set on dialogs that open from inside another popover (e.g. the SaveFilterDialog
     *  inside the AdvancedFilterPanel popover) so they aren't hidden behind the popover. */
    elevated?: boolean
    /** Render the auto close button top-right. @default true */
    dismissible?: boolean
    /** Aria label for the auto close button. Defaults to the
     * `ui.dialog.close.ariaLabel` translation (`"Close"`). */
    closeAriaLabel?: string
    /** Skip the automatic `DialogBody` grouping and render children verbatim.
     * For panels that lay out their own full-bleed chrome. @default false */
    disableBodyWrap?: boolean
  }

/** How far to descend looking for slots nested inside a layout wrapper — the
 *  `<DialogHeader/><form>…<DialogFooter/></form>` shape is the common case. */
const MAX_SLOT_DEPTH = 2

function isDialogSlot(node: React.ReactNode): boolean {
  if (!React.isValidElement(node)) return false
  return node.type === DialogHeader || node.type === DialogFooter || node.type === DialogBody
}

function wrapsDialogSlot(node: React.ReactNode): boolean {
  if (!React.isValidElement(node)) return false
  const nested = (node.props as { children?: React.ReactNode })?.children
  if (nested === undefined) return false
  return React.Children.toArray(nested).some(isDialogSlot)
}

/** Groups every run of non-slot children into a `DialogBody` so body padding
 *  is slot-owned without every call site having to say so. Order is preserved;
 *  a layout wrapper that itself holds slots is descended into rather than
 *  wrapped, so its footer keeps footer padding. */
function applyDialogSlots(children: React.ReactNode, depth = 0): React.ReactNode {
  const items = React.Children.toArray(children)
  if (items.length === 0) return children

  const out: React.ReactNode[] = []
  let run: React.ReactNode[] = []

  const flush = () => {
    if (run.length === 0) return
    out.push(<DialogBody key={`dialog-body-${out.length}`}>{run}</DialogBody>)
    run = []
  }

  for (const child of items) {
    if (isDialogSlot(child)) {
      flush()
      out.push(child)
      continue
    }
    if (depth < MAX_SLOT_DEPTH && wrapsDialogSlot(child)) {
      flush()
      const element = child as React.ReactElement<{ children?: React.ReactNode }>
      out.push(
        React.cloneElement(
          element,
          undefined,
          applyDialogSlots(element.props.children, depth + 1),
        ),
      )
      continue
    }
    run.push(child)
  }
  flush()

  return out
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(
  (
    {
      className,
      children,
      elevated,
      size,
      dismissible = true,
      closeAriaLabel,
      disableBodyWrap = false,
      ...props
    },
    ref,
  ) => {
    const t = useT()

    React.useEffect(() => {
      return () => {
        if (typeof window === 'undefined') return
        window.setTimeout(() => {
          if (document.querySelector('[data-dialog-content][data-state="open"]')) return
          document.body.style.removeProperty('overflow')
          document.body.style.removeProperty('pointer-events')
        }, 0)
      }
    }, [])

    const chrome = React.useMemo(() => ({ dismissible }), [dismissible])
    const body = React.useMemo(
      () => (disableBodyWrap ? children : applyDialogSlots(children)),
      [children, disableBodyWrap],
    )

    return (
      <DialogPortal>
        <DialogOverlay elevated={elevated} />
        <DialogPrimitive.Content
          ref={ref}
          data-dialog-content=""
          data-slot="dialog-content"
          data-size={size ?? 'default'}
          className={cn(
            dialogContentVariants({ size }),
            elevated ? 'z-modal-elevated' : 'z-modal',
            className,
          )}
          {...props}
        >
          {dismissible ? (
            <DialogClose asChild data-dialog-close="">
              <CloseButton
                data-slot="dialog-close-button"
                className="absolute right-5 top-4 z-10 sm:right-6"
                aria-label={closeAriaLabel ?? t('ui.dialog.close.ariaLabel', 'Close')}
              />
            </DialogClose>
          ) : null}
          <DialogChromeContext.Provider value={chrome}>{body}</DialogChromeContext.Provider>
        </DialogPrimitive.Content>
      </DialogPortal>
    )
  },
)
DialogContent.displayName = DialogPrimitive.Content.displayName

export type DialogHeaderTone =
  | 'default'
  | 'accent'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'

// Soft-tinted status leading badges. Each status tone uses the soft tint
// background paired with a saturated colored icon (red `!` on light pink,
// amber triangle on light amber, green check on light green, indigo `i` on
// light indigo). The bordered `default` tone keeps the surface + border shell
// for generic settings icons.
const DIALOG_HEADER_TONE_CLASS: Record<DialogHeaderTone, string> = {
  default: 'border border-border bg-surface text-muted-foreground',
  accent: 'bg-accent-strong/10 text-accent-strong',
  success: 'bg-status-success-bg text-status-success-icon',
  warning: 'bg-status-warning-bg text-status-warning-icon',
  error: 'bg-status-error-bg text-status-error-icon',
  info: 'bg-status-info-bg text-status-info-icon',
}

export type DialogHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Optional leading icon — rendered inside a size-10 rounded-full
   * badge to the left of the title block. */
  leading?: React.ReactNode
  /** Visual tone for the leading badge. `default` keeps the
   * bordered surface badge (generic settings icons); status tones
   * (`success`/`warning`/`error`/`info`) use the matching
   * `bg-status-*-bg text-status-*-icon` tint. Use `error` / `warning` to
   * signal destructive flows via the badge instead of a red CTA button.
   * @default 'default' */
  leadingTone?: DialogHeaderTone
}

const DialogHeader = ({
  className,
  leading,
  leadingTone = 'default',
  children,
  ...props
}: DialogHeaderProps) => {
  const { dismissible } = React.useContext(DialogChromeContext)
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        'shrink-0 px-5 py-4 text-left sm:px-6',
        // Reserve the close-button gutter (28px box + the 16px gap it sits on)
        // so a long title never runs under it.
        dismissible ? 'pr-11 sm:pr-12' : '',
        leading ? 'flex items-start gap-3' : 'flex flex-col gap-0.5',
        className,
      )}
      {...props}
    >
      {leading ? (
        <span
          data-slot="dialog-header-leading"
          data-tone={leadingTone}
          aria-hidden="true"
          className={cn(
            // Same 28px box / 16px glyph as CloseButton, so the badge, the
            // title's first line and the close button all sit on one band.
            // The icon size is owned here — a call site must not change it.
            'inline-flex size-7 shrink-0 items-center justify-center rounded-full [&>svg]:size-4',
            DIALOG_HEADER_TONE_CLASS[leadingTone],
          )}
        >
          {leading}
        </span>
      ) : null}
      {leading ? (
        <div
          data-slot="dialog-header-text"
          className="flex min-w-0 flex-1 flex-col gap-1 text-left"
        >
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  )
}
DialogHeader.displayName = 'DialogHeader'

const DialogBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="dialog-body"
    className={cn('px-5 pt-3 pb-5 sm:px-6', className)}
    {...props}
  />
)
DialogBody.displayName = 'DialogBody'

export type DialogFooterProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Footer layout. `default` is the right-aligned button row.
   * `equal` stretches children flex-1 for 50/50 confirmation footers. */
  layout?: 'default' | 'equal'
  /** Opt in to a `border-t` rule above the button row. Off by default —
   * the canonical chrome is borderless and takes its rhythm from padding.
   * Reserve this for a long scrolling body where the row would otherwise
   * float over content. @default false */
  bordered?: boolean
  /** Optional left-side slot — typically a "Don't show it again"
   * CheckboxField, a "Remember me" Switch, a left link button, or a
   * step-indicator. When provided, children stay right-aligned and the
   * leading slot anchors left. Mutually exclusive with `layout="equal"`. */
  leading?: React.ReactNode
}

const DIALOG_FOOTER_BASE = 'shrink-0 px-5 pt-1.5 pb-4 sm:px-6'

const DialogFooter = ({
  className,
  layout = 'default',
  bordered = false,
  leading,
  children,
  ...props
}: DialogFooterProps) => {
  const rule = bordered ? 'border-t border-border pt-4' : ''

  if (layout === 'equal') {
    return (
      <div
        data-slot="dialog-footer"
        data-layout="equal"
        data-bordered={bordered ? 'true' : undefined}
        className={cn(
          DIALOG_FOOTER_BASE,
          rule,
          'flex flex-row gap-2 [&>*]:flex-1',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    )
  }

  if (leading) {
    return (
      <div
        data-slot="dialog-footer"
        data-layout="default"
        data-bordered={bordered ? 'true' : undefined}
        className={cn(
          DIALOG_FOOTER_BASE,
          rule,
          'flex flex-col gap-3 sm:flex-row sm:items-center',
          className,
        )}
        {...props}
      >
        <div
          data-slot="dialog-footer-leading"
          className="inline-flex items-center gap-2 sm:mr-auto"
        >
          {leading}
        </div>
        <div
          data-slot="dialog-footer-trailing"
          className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center"
        >
          {children}
        </div>
      </div>
    )
  }

  return (
    <div
      data-slot="dialog-footer"
      data-layout="default"
      data-bordered={bordered ? 'true' : undefined}
      className={cn(
        DIALOG_FOOTER_BASE,
        rule,
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    data-slot="dialog-title"
    className={cn('text-xl font-semibold tracking-tight text-foreground', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    data-slot="dialog-description"
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
