"use client"

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CloseButton, type CloseButtonSize } from './close-button'

/**
 * Modal dialog primitive. Chrome follows the canonical borderless scheme:
 * a `rounded-2xl bg-surface shadow-xl` panel on a `bg-scrim` overlay,
 * with the vertical rhythm carried entirely by the padding trio (header,
 * body, footer below) and NO divider under the header or above the footer.
 * Don't reintroduce chrome dividers. Content-level hairlines (table rows, card
 * caption strips) are not chrome and are fine.
 *
 * The panel's outer margin is the same on all four sides, 20px on a phone and
 * 24px from `sm`: the title sits as far below the top edge as it is in from the
 * left, the buttons as far above the bottom edge as they are in from the right,
 * and the close button on the title's centre line, as far in from the right.
 *
 * Sizing is desktop-first: a plain `max-w-*`, `h-*`, `max-h-*` or `top-*` on
 * `DialogContent` sizes the centred panel, as it reads, and `sm:`-prefixed
 * classes still work. The phone bottom sheet lives entirely under `max-sm:`,
 * so those overrides never reach it. It used to be the other way round, and a
 * plain `max-w-3xl` silently lost to the base's `sm:max-w-lg`.
 *
 * Body padding is slot-owned, so `DialogContent` groups any children that
 * aren't a Header/Footer/Body into a `DialogBody` automatically. Wrap content
 * in an explicit `<DialogBody>` when you need to pass it a className, or set
 * `disableBodyWrap` to lay the panel out by hand.
 *
 * Additive props beyond the Radix contract:
 *   DialogContent: `size` ('sm' | 'default' | 'lg' | 'xl'), `dismissible`,
 *     `elevated`, `disableBodyWrap`
 *   DialogFooter:  `layout` ('default' | 'equal'), `leading` slot, `bordered`
 *     (opt-in rule — off by default per the borderless chrome above)
 */

/** Title type for every modal surface: dialog, sheet, drawer and the confirm
 *  alert. One class, so the surfaces cannot drift apart again. */
export const DIALOG_TITLE_CLASS = 'text-lg font-semibold tracking-tight text-foreground'

export const DIALOG_DESCRIPTION_CLASS = 'text-sm text-muted-foreground'

/** Header insets: the top inset matches the side inset. Directly above a
 *  footer the header gives up its bottom padding, because the footer owns
 *  the gap above its buttons. */
export const DIALOG_HEADER_INSET_CLASS = 'px-5 pt-5 pb-3 sm:px-6 sm:pt-6 [&:has(+[data-slot$=footer])]:pb-0'

/** Header: the insets above, and a 4px step between title and description. */
export const DIALOG_HEADER_CLASS = `flex shrink-0 flex-col gap-1 text-left ${DIALOG_HEADER_INSET_CLASS}`

/** Body: when it is the last slot its bottom padding is the panel's bottom
 *  inset. Above a footer it gives that padding up, because a body that
 *  scrolls hides its own padding at the end of the scroll, and the buttons
 *  used to sit 4px under the last visible field. A bordered footer keeps the
 *  body's padding above its rule. */
export const DIALOG_BODY_CLASS =
  'px-5 pt-3 pb-5 sm:px-6 sm:pb-6 [&:has(+[data-slot$=footer]:not([data-bordered]))]:pb-0'

/** Footer: 20px above the buttons whatever sits above them, scrolling or
 *  not, and a bottom inset that matches the side inset. */
export const DIALOG_FOOTER_CLASS = 'shrink-0 px-5 pt-5 pb-5 sm:px-6 sm:pb-6'

/** The close button on the title's 28px centre line, as far in from the right
 *  edge as the title is from the left; a smaller or larger box is nudged so its
 *  centre stays on that line. */
export const DIALOG_CLOSE_POSITION_CLASS: Record<CloseButtonSize, string> = {
  sm: 'absolute right-5 top-5.5 z-10 sm:right-6 sm:top-6.5',
  md: 'absolute right-5 top-5 z-10 sm:right-6 sm:top-6',
  lg: 'absolute right-5 top-4.5 z-10 sm:right-6 sm:top-5.5',
}

/** Room a header keeps clear of the close button: its inset, its box and an
 *  8px gap, so a long title wraps before it reaches the button. */
export const DIALOG_CLOSE_GUTTER_CLASS: Record<CloseButtonSize, string> = {
  sm: 'pr-13 sm:pr-14',
  md: 'pr-14 sm:pr-15',
  lg: 'pr-15 sm:pr-16',
}

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
      'fixed inset-0 bg-scrim animate-fadeIn transition-opacity data-[state=closed]:animate-out',
      elevated ? 'z-modal-elevated' : 'z-modal',
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const dialogContentVariants = cva(
  [
    'fixed left-1/2 top-1/2 flex h-auto max-h-[calc(100dvh-4rem)] w-full -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-2xl bg-surface shadow-xl animate-fadeInUp focus-visible:outline-none data-[state=closed]:animate-out',
    'max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[92dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'max-w-sm',
        default: 'max-w-lg',
        lg: 'max-w-2xl',
        xl: 'max-w-4xl',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
)

/** Lets DialogHeader reserve the close-button gutter only when one renders,
 *  sized for the button that does. */
const DialogChromeContext = React.createContext<{ dismissible: boolean; closeSize: CloseButtonSize }>({
  dismissible: false,
  closeSize: 'md',
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
    /** Size of the auto close button. `CloseButton` has carried this scale all
     * along but `DialogContent` pinned it to the default, so a dialog that
     * wanted a larger dismiss had no way to ask for one without reaching past
     * the primitive. Dense dialogs keep `md`; tall scrolling panels, where the
     * close is the only way out that stays on screen, take `lg`.
     * @default 'md' */
    closeSize?: CloseButtonSize
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
      closeSize,
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

    const resolvedCloseSize = closeSize ?? 'md'
    const chrome = React.useMemo(
      () => ({ dismissible, closeSize: resolvedCloseSize }),
      [dismissible, resolvedCloseSize],
    )
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
                size={resolvedCloseSize}
                data-slot="dialog-close-button"
                className={DIALOG_CLOSE_POSITION_CLASS[resolvedCloseSize]}
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

/**
 * A dialog header is a title, an optional description, and nothing else.
 *
 * It used to take a `leading` icon badge with a `leadingTone` tint. The prop is
 * gone rather than merely unused: a modal header carries no iconography in this
 * product, and leaving the capability in place meant the rule held only for as
 * long as nobody reached for it. Six call sites had, and they each picked a
 * different glyph for the same slot, so the badge was decorating the title
 * rather than saying anything the title did not.
 *
 * Signal a destructive flow through the CTA — `destructive`,
 * `destructive-solid`, `destructive-outline` on the confirm Button — and
 * through the copy, not through a tinted badge beside the heading.
 */
export type DialogHeaderProps = React.HTMLAttributes<HTMLDivElement>

const DialogHeader = ({
  className,
  children,
  ...props
}: DialogHeaderProps) => {
  const { dismissible, closeSize } = React.useContext(DialogChromeContext)
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        DIALOG_HEADER_CLASS,
        dismissible ? DIALOG_CLOSE_GUTTER_CLASS[closeSize] : '',
        className,
      )}
      {...props}
    >
      {children}
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
    className={cn(DIALOG_BODY_CLASS, className)}
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

const DIALOG_FOOTER_BASE = DIALOG_FOOTER_CLASS

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
    className={cn(DIALOG_TITLE_CLASS, className)}
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
    className={cn(DIALOG_DESCRIPTION_CLASS, className)}
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
