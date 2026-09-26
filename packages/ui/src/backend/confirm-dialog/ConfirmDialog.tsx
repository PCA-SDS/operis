"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { Button } from "@open-mercato/ui/primitives/button";
import { CloseButton } from "../../primitives/close-button";
import {
  DIALOG_BODY_CLASS,
  DIALOG_CLOSE_GUTTER_CLASS,
  DIALOG_CLOSE_POSITION_CLASS,
  DIALOG_DESCRIPTION_CLASS,
  DIALOG_FOOTER_CLASS,
  DIALOG_HEADER_CLASS,
  DIALOG_TITLE_CLASS,
} from "../../primitives/dialog";
import { cn } from "@open-mercato/shared/lib/utils";
import { Loader2 } from "lucide-react";

export type ConfirmDialogProps = {
  /** Whether the dialog is open (controlled mode — used by useConfirmDialog) */
  open?: boolean;
  /** Callback when open state changes (controlled mode) */
  onOpenChange?: (open: boolean) => void;
  /** Callback when user confirms */
  onConfirm: () => void | Promise<void>;
  /** Callback when user cancels (optional, defaults to closing) */
  onCancel?: () => void;
  /** Dialog title. Defaults to i18n key "ui.dialogs.confirm.defaultTitle" ("Are you sure?") */
  title?: string;
  /** Dialog body text / description */
  text?: string;
  /** Confirm button label. Defaults to i18n "ui.dialogs.confirm.confirmText" ("Confirm").
   *  Pass `false` to hide the confirm button entirely. */
  confirmText?: string | false;
  /** Cancel button label. Defaults to i18n "ui.dialogs.confirm.cancelText" ("Cancel").
   *  Pass `false` to hide the cancel button entirely. */
  cancelText?: string | false;
  /** Visual variant — "destructive" renders the confirm button in red */
  variant?: "default" | "destructive";
  /** Whether the confirm button shows a loading spinner.
   *  Useful for async onConfirm handlers (e.g., waiting for API response before closing). */
  loading?: boolean;
  /** Trigger element — when provided, component manages its own open state (declarative mode).
   *  Clicking the trigger opens the dialog. */
  trigger?: React.ReactNode;
};

export function ConfirmDialog({
  open: controlledOpen,
  onOpenChange,
  onConfirm,
  onCancel,
  title,
  text,
  confirmText,
  cancelText,
  variant = "default",
  loading = false,
  trigger,
}: ConfirmDialogProps) {
  const t = useT();
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [internalOpen, setInternalOpen] = React.useState(false);
  const cancelButtonRef = React.useRef<HTMLButtonElement>(null);
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);
  const [portalTarget, setPortalTarget] = React.useState<HTMLElement | null>(null);
  // Unique IDs so multiple ConfirmDialog instances on the same page don't
  // collide and make `aria-labelledby` resolve to the wrong dialog's title.
  const reactId = React.useId();
  const titleId = `confirm-dialog-title-${reactId}`;
  const descriptionId = `confirm-dialog-description-${reactId}`;

  // Determine if we're in controlled mode (open prop provided) or declarative mode (trigger provided)
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled
    ? onOpenChange || (() => {})
    : setInternalOpen;
  const handleCancelCallback = React.useCallback(() => {
    if (!isControlled) {
      onCancel?.();
    }
  }, [isControlled, onCancel]);

  // Default text values from i18n
  const resolvedTitle =
    title ?? t("ui.dialogs.confirm.defaultTitle", "Are you sure?");
  const resolvedConfirmText =
    confirmText === false
      ? false
      : confirmText ?? t("ui.dialogs.confirm.confirmText", "Confirm");
  const resolvedCancelText =
    cancelText === false
      ? false
      : cancelText ?? t("ui.dialogs.confirm.cancelText", "Cancel");
  const closeAriaLabel = t("ui.dialog.close.ariaLabel", "Close");
  const requestClose = React.useCallback(() => {
    setOpen(false);
    handleCancelCallback();
  }, [setOpen, handleCancelCallback]);

  React.useLayoutEffect(() => {
    setPortalTarget(document.body);
  }, []);

  // Handle dialog open/close with native showModal/close
  React.useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
        // Focus cancel button (safe default) or confirm if no cancel
        setTimeout(() => {
          if (resolvedCancelText !== false && cancelButtonRef.current) {
            cancelButtonRef.current.focus();
          } else if (confirmButtonRef.current) {
            confirmButtonRef.current.focus();
          }
        }, 0);
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [open, resolvedCancelText, portalTarget]);

  // Handle native cancel event (Escape key)
  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      // Prevent close if loading
      if (loading) {
        e.preventDefault();
        return;
      }
      requestClose();
    };

    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [loading, requestClose]);

  React.useEffect(() => {
    if (!open) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!(event.target instanceof Node) || !dialogRef.current?.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!loading) requestClose();
    };

    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [loading, open, requestClose]);

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    // Only close if clicking directly on the dialog (backdrop), not its children
    if (e.target === dialogRef.current && !loading) {
      requestClose();
    }
  };

  // Handle keyboard shortcuts
  React.useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+Enter confirms
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !loading) {
        e.preventDefault();
        handleConfirm();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, loading]);

  const handleConfirm = async () => {
    await onConfirm();
    // Don't auto-close if loading — let the parent control when to close
    if (!loading) {
      setOpen(false);
    }
  };

  const handleCancel = () => {
    requestClose();
  };

  const handleTriggerClick = () => {
    if (trigger) {
      setOpen(true);
    }
  };

  // An alert offers its way out as Cancel, as Apple's do; a close button beside
  // Cancel is a second control for the same act. It returns only when a caller
  // hides Cancel, so the dialog still has a visible way out besides Escape.
  const showCloseButton = resolvedCancelText === false;

  const dialogElement = (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={text ? descriptionId : undefined}
      onClick={handleBackdropClick}
      className={cn(
        // Reset dialog defaults
        "m-0 p-0 max-w-none bg-transparent border-none pointer-events-auto",
        // Backdrop — the canonical modal scrim (no blur).
        "backdrop:bg-scrim backdrop:transition-opacity",
        // Mobile: bottom sheet
        "fixed inset-x-0 bottom-0 top-auto w-full",
        // Desktop: centered
        "sm:inset-auto sm:mx-auto sm:my-auto sm:max-w-md sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2"
      )}
    >
      <div
        role="document"
        className={cn(
          // Panel — the dialog's chrome and its entrance: the rhythm comes from
          // the shared header/body/footer insets, never from divider lines.
          "relative flex flex-col rounded-t-2xl bg-surface text-foreground shadow-xl animate-fadeInUp",
          "sm:rounded-2xl"
        )}
      >
        {showCloseButton ? (
          <CloseButton
            onClick={handleCancel}
            disabled={loading}
            aria-label={closeAriaLabel}
            className={DIALOG_CLOSE_POSITION_CLASS.md}
          />
        ) : null}

        {/* Header */}
        <div className={cn(DIALOG_HEADER_CLASS, showCloseButton && DIALOG_CLOSE_GUTTER_CLASS.md)}>
          <h2 id={titleId} className={DIALOG_TITLE_CLASS}>
            {resolvedTitle}
          </h2>
        </div>

        {/* Body (optional) */}
        {text && (
          <div className={cn("shrink-0", DIALOG_BODY_CLASS)}>
            <p id={descriptionId} className={DIALOG_DESCRIPTION_CLASS}>
              {text}
            </p>
          </div>
        )}

        {/* Actions */}
        <div
          data-slot="confirm-dialog-footer"
          className={cn(DIALOG_FOOTER_CLASS, "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end")}
        >
          {resolvedCancelText !== false && (
            <Button
              ref={cancelButtonRef}
              variant="outline"
              onClick={handleCancel}
              disabled={loading}
              className="w-full sm:w-auto"
            >
              {resolvedCancelText}
            </Button>
          )}
          {resolvedConfirmText !== false && (
            <Button
              ref={confirmButtonRef}
              variant={variant === "destructive" ? "destructive-solid" : "default"}
              onClick={handleConfirm}
              disabled={loading}
              className="w-full sm:w-auto"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {resolvedConfirmText}
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );

  return (
    <>
      {trigger && (
        <div onClick={handleTriggerClick} className="inline-block" role="presentation">
          {trigger}
        </div>
      )}

      {portalTarget ? createPortal(dialogElement, portalTarget) : null}
    </>
  );
}
