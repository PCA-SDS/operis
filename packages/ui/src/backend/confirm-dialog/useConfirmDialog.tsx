"use client";
import * as React from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { createLogger } from "@open-mercato/shared/lib/logger";

const logger = createLogger("ui");

function DialogMountTracker({ trackerRef }: { trackerRef: React.MutableRefObject<boolean> }) {
  React.useEffect(() => {
    trackerRef.current = true;
    return () => {
      trackerRef.current = false;
    };
  }, [trackerRef]);
  return null;
}

export type ConfirmDialogOptions = {
  title?: string;
  text?: string;
  description?: string;
  confirmText?: string | false;
  cancelText?: string | false;
  variant?: "default" | "destructive";
  /**
   * Optional work to run while the dialog stays open in its loading state.
   *
   * Without this the dialog closes the instant Confirm is pressed and the row
   * sits unchanged until the caller's request returns — the classic "did that
   * work?" gap. Supplying it keeps `ConfirmDialog`'s existing loading contract
   * engaged (both buttons disabled, spinner shown, Escape / outside-click /
   * Cmd+Enter blocked) until the promise settles, which also makes a second
   * confirm physically impossible.
   *
   * `confirm()` still resolves `true` once the work succeeds. If the work
   * throws, the dialog closes and `confirm()` REJECTS with that error, so the
   * caller's existing try/catch handles it — callers that do not pass
   * `onConfirm` are completely unaffected.
   */
  onConfirm?: () => Promise<unknown> | unknown;
};

export type UseConfirmDialogReturn = {
  /**
   * Call this to show a confirmation dialog. Resolves `true` if confirmed,
   * `false` if cancelled. When `options.onConfirm` is supplied the dialog stays
   * open in its loading state until that work settles, and this rejects if the
   * work throws.
   */
  confirm: (options?: ConfirmDialogOptions) => Promise<boolean>;
  /** Render this in your component tree (renders the <dialog> element) */
  ConfirmDialogElement: React.ReactNode;
};

export function useConfirmDialog(): UseConfirmDialogReturn {
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<ConfirmDialogOptions>({});
  const [loading, setLoading] = React.useState(false);
  const resolveRef = React.useRef<((value: boolean) => void) | null>(null);
  const rejectRef = React.useRef<((reason: unknown) => void) | null>(null);
  const openRef = React.useRef(false);
  const isDialogElementRenderedRef = React.useRef(false);
  const queueRef = React.useRef<Array<{
    options?: ConfirmDialogOptions;
    resolve: (value: boolean) => void;
    reject: (reason: unknown) => void;
  }>>([]);

  const processQueue = React.useCallback(() => {
    if (openRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    // Reserve the open slot synchronously so a confirm() call dispatched
    // between this microtask scheduling and the actual setState cannot
    // race ahead and double-open the dialog.
    openRef.current = true;
    resolveRef.current = next.resolve;
    rejectRef.current = next.reject;
    // Defer the React state writes to a microtask so they run after any
    // parent component's useInsertionEffect commit phase (Radix Dialog,
    // CSS-in-JS layer injection, etc.). React 18/19 rejects setState
    // scheduled during the insertion-effect phase with the warning
    // "useInsertionEffect must not schedule updates" — see #1810.
    queueMicrotask(() => {
      setOptions(next.options || {});
      setOpen(true);
    });
  }, []);
  const finalizeInteraction = React.useCallback(() => {
    // Reset openRef BEFORE scheduling queue work so a subsequent confirm()
    // call from the parent's onOpenChange propagation isn't dropped by the
    // openRef.current === true guard (#1804). The visible dialog still
    // closes via setOpen(false); only the internal lock flips early.
    openRef.current = false;
    setOpen(false);
    // Defer queue advancement to the next microtask so the parent's
    // onOpenChange / Promise resolution has a chance to propagate before
    // a queued request reopens the dialog with new options.
    queueMicrotask(() => {
      processQueue();
    });
  }, [processQueue]);

  const confirm = React.useCallback(
    (newOptions?: ConfirmDialogOptions): Promise<boolean> => {
      return new Promise<boolean>((resolve, reject) => {
        // Development-mode guard: warn if dialog element is not mounted
        if (
          process.env.NODE_ENV === "development" &&
          !isDialogElementRenderedRef.current
        ) {
          logger.warn("useConfirmDialog: confirm() was called but ConfirmDialogElement is not rendered. Add {ConfirmDialogElement} to your JSX.");
        }

        // If dialog is already open or a previous interaction is still
        // resolving, enqueue this request. processQueue() picks it up after
        // the in-flight interaction finalises.
        if (openRef.current || resolveRef.current) {
          queueRef.current.push({ options: newOptions, resolve, reject });
          return;
        }

        // Otherwise, claim the open slot synchronously and defer the
        // actual setState writes to a microtask (same rationale as
        // processQueue — keeps us out of the parent's insertion-effect
        // commit phase).
        openRef.current = true;
        resolveRef.current = resolve;
        rejectRef.current = reject;
        queueMicrotask(() => {
          setOptions(newOptions || {});
          setOpen(true);
        });
      });
    },
    []
  );

  const handleConfirm = React.useCallback(async () => {
    const resolve = resolveRef.current;
    const reject = rejectRef.current;
    const work = options.onConfirm;

    // Legacy path — no `onConfirm` supplied. Unchanged from before: resolve and
    // close immediately. (The old code also flipped `loading` on and off here,
    // but both writes landed in one synchronous tick so React batched them and
    // the loading state never rendered a frame.)
    if (!work) {
      resolveRef.current = null;
      rejectRef.current = null;
      resolve?.(true);
      finalizeInteraction();
      return;
    }

    // Opt-in path: hold the dialog open, and its loading contract engaged,
    // until the caller's work settles.
    setLoading(true);
    try {
      await work();
      resolveRef.current = null;
      rejectRef.current = null;
      resolve?.(true);
    } catch (err) {
      resolveRef.current = null;
      rejectRef.current = null;
      if (reject) reject(err);
      else logger.error("useConfirmDialog: onConfirm threw with no pending promise", { err });
    } finally {
      setLoading(false);
      finalizeInteraction();
    }
  }, [finalizeInteraction, options]);

  const handleCancel = React.useCallback(() => {
    // Resolve with false (cancelled)
    const resolve = resolveRef.current;
    resolveRef.current = null;
    rejectRef.current = null;
    resolve?.(false);
    finalizeInteraction();
  }, [finalizeInteraction]);

  const handleOpenChange = React.useCallback(
    (newOpen: boolean) => {
      if (!newOpen && openRef.current) {
        handleCancel();
      }
    },
    [handleCancel]
  );

  const ConfirmDialogElement = React.useMemo(
    () => (
      <>
        <DialogMountTracker trackerRef={isDialogElementRenderedRef} />
        <ConfirmDialog
          open={open}
          onOpenChange={handleOpenChange}
          onConfirm={handleConfirm}
          title={options.title}
          text={options.text ?? options.description}
          confirmText={options.confirmText}
          cancelText={options.cancelText}
          variant={options.variant}
          loading={loading}
        />
      </>
    ),
    [
      open,
      handleOpenChange,
      handleConfirm,
      options,
      loading,
    ]
  );

  return {
    confirm,
    ConfirmDialogElement,
  };
}
