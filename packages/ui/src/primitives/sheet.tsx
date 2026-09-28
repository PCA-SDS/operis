'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'
import { CloseButton } from './close-button'
import {
  DIALOG_CLOSE_GUTTER_CLASS,
  DIALOG_CLOSE_POSITION_CLASS,
  DIALOG_DESCRIPTION_CLASS,
  DIALOG_FOOTER_CLASS,
  DIALOG_HEADER_CLASS,
  DIALOG_TITLE_CLASS,
} from './dialog'
import { SIDE_PANEL_MOTION, SIDE_PANEL_SCRIM_MOTION } from './side-panel-motion'

const Sheet = DialogPrimitive.Root

const SheetTrigger = DialogPrimitive.Trigger

const SheetClose = DialogPrimitive.Close

const SheetPortal = DialogPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    className={cn(
      'fixed inset-x-0 bottom-0 top-[var(--topbar-height,0px)] z-overlay bg-scrim',
      SIDE_PANEL_SCRIM_MOTION,
      className,
    )}
    {...props}
    ref={ref}
  />
))
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName

// The motion is the one every side panel shares (`side-panel-motion.ts`).
const sheetVariants = cva(
  'fixed z-modal flex flex-col gap-4 bg-surface shadow-xl',
  {
    variants: {
      side: {
        top: `inset-x-0 top-0 ${SIDE_PANEL_MOTION.top}`,
        bottom: `inset-x-0 bottom-0 ${SIDE_PANEL_MOTION.bottom}`,
        left: `top-[var(--topbar-height,0px)] bottom-0 left-0 w-3/4 sm:max-w-md ${SIDE_PANEL_MOTION.left}`,
        right: `top-[var(--topbar-height,0px)] bottom-0 right-0 w-full sm:max-w-md ${SIDE_PANEL_MOTION.right}`,
      },
    },
    defaultVariants: {
      side: 'right',
    },
  }
)

export type SheetContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> &
  VariantProps<typeof sheetVariants> & {
    /** Hide the built-in close (X) button — useful when the consumer renders its own close affordance. */
    hideClose?: boolean
    /** Override the aria-label for the built-in close button. */
    closeLabel?: string
  }

/**
 * SheetContent — side-anchored Radix Dialog wrapper.
 *
 * Topbar integration: the `left` and `right` variants anchor at
 * `top: var(--topbar-height, 0px)` so a sticky app topbar stays visible above
 * the panel. Consumers that render inside `AppShell` get the correct offset
 * because the shell sets `--topbar-height` on the outer container. Surfaces
 * outside the shell (portal modals, marketing pages, standalone embeds) keep
 * the default `0px` fallback and align to the viewport top — that is the
 * correct behavior when there is no topbar to clear.
 *
 * To opt into the offset from your own layout, set the CSS variable on any
 * ancestor of `<SheetContent>`:
 *
 * ```css
 * .my-shell { --topbar-height: 60px; }
 * ```
 */

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side = 'right', className, children, hideClose = false, closeLabel = 'Close', ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
      {children}
      {!hideClose ? (
        <DialogPrimitive.Close asChild>
          <CloseButton className={DIALOG_CLOSE_POSITION_CLASS.md} aria-label={closeLabel} />
        </DialogPrimitive.Close>
      ) : null}
    </DialogPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = DialogPrimitive.Content.displayName

const SheetHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sheet-header"
      className={cn(DIALOG_HEADER_CLASS, DIALOG_CLOSE_GUTTER_CLASS.md, className)}
      {...props}
    />
  ),
)
SheetHeader.displayName = 'SheetHeader'

const SheetFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sheet-footer"
      className={cn(DIALOG_FOOTER_CLASS, 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  ),
)
SheetFooter.displayName = 'SheetFooter'

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(DIALOG_TITLE_CLASS, className)}
    {...props}
  />
))
SheetTitle.displayName = DialogPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn(DIALOG_DESCRIPTION_CLASS, className)}
    {...props}
  />
))
SheetDescription.displayName = DialogPrimitive.Description.displayName

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
  sheetVariants,
}
