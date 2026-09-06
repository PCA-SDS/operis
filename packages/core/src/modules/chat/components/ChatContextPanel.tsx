"use client"

import * as React from 'react'
import { X } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { CHAT_PANEL_WIDTH, clampPanelWidth, maxPanelWidthFor } from './contextPanel'

/**
 * The conversation's contextual region, and the edge you drag to size it.
 *
 * Beside the transcript rather than over it. A dialog answers "look at this
 * now"; pins and shared files answer "where did that go?", which is a question
 * you ask *while* reading, and covering the conversation to answer it is what
 * made the old modal a detour — you could not check a pin against the message
 * you were writing.
 *
 * Below the width where both panes fit, the same content becomes a drawer. Two
 * unusable columns are worse than one usable one, and which of those a given
 * screen can hold is a question about the container rather than about the
 * device (§11).
 */

export type ChatContextPanelProps = {
  open: boolean
  /** Whether the container can hold a transcript and a panel side by side. */
  split: boolean
  title: string
  /** Fitted to the container by the caller; used as the flex basis in split mode. */
  width: number
  containerWidth: number
  onWidthChange: (width: number) => void
  onResetWidth: () => void
  onClose: () => void
  children: React.ReactNode
}

export function ChatContextPanel({
  open,
  split,
  title,
  width,
  containerWidth,
  onWidthChange,
  onResetWidth,
  onClose,
  children,
}: ChatContextPanelProps) {
  const t = useT()

  if (!open) return null

  if (!split) {
    return (
      <Drawer open onOpenChange={(next) => (next ? undefined : onClose())}>
        <DrawerContent side="right" className="flex flex-col" closeAriaLabel={t('chat.panel.close', 'Close panel')}>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          {/* The drawer owns the scroll here, exactly as the split panel's own
              body does — the transcript behind it keeps its position either way. */}
          <DrawerBody className="min-h-0 flex-1 overflow-y-auto">{children}</DrawerBody>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <>
      <ChatPanelResizeHandle
        width={width}
        containerWidth={containerWidth}
        onWidthChange={onWidthChange}
        onReset={onResetWidth}
      />
      <aside
        aria-label={title}
        // `shrink-0` with an explicit basis: the transcript beside it is the
        // flexible one. Without it a long filename inside the panel would widen
        // the panel instead of wrapping, and the width the reader chose would
        // stop being the width they get.
        style={{ width, flexBasis: width }}
        // No left border here: the resize handle draws the divider, so the two
        // are one line rather than two coincident ones. With a border here as
        // well, the handle's hover state painted `border` over an identical
        // `border` and the affordance was invisible (§32, §64).
        className="flex min-h-0 shrink-0 flex-col overflow-hidden"
      >
        {/* `h-14` and `px-4` are the conversation header's own values, so the
            rule under the two headers is one continuous line and the panel
            title starts on the same vertical as the rows beneath it — the body
            pads 2 and each row pads 2, which lands their content at 4. */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</h2>
          <IconButton
            type="button"
            variant="ghost"
            // 32px, matching the conversation header's controls. The two
            // headers sit side by side at the same height, so a 28px control
            // here would read as a smaller target on the same rule.
            size="default"
            className="shrink-0"
            onClick={onClose}
            aria-label={t('chat.panel.close', 'Close panel')}
            title={t('chat.panel.close', 'Close panel')}
          >
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        </header>
        {/* Its own scrollport. Tying it to the transcript would mean scrolling
            the conversation to reach the bottom of a pin list (§24). */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">{children}</div>
      </aside>
    </>
  )
}

/**
 * The edge between the transcript and the panel.
 *
 * Dragging left widens the panel: the handle is the panel's leading edge, so it
 * moves with the pointer and the two sides trade width directly (§5).
 *
 * It paints a hairline rather than a bar. The border it sits on is the
 * separation the layout already needed, and a second painted element there
 * would read as chrome rather than as an edge you can take hold of — the same
 * reasoning the table's column handles follow. Discovery is the `col-resize`
 * cursor over a hit zone wider than the line itself.
 */
function ChatPanelResizeHandle({
  width,
  containerWidth,
  onWidthChange,
  onReset,
}: {
  width: number
  containerWidth: number
  onWidthChange: (width: number) => void
  onReset: () => void
}) {
  const t = useT()
  const [active, setActive] = React.useState(false)
  // An unmount mid-drag — the panel closing, the layout dropping to drawer mode
  // under a window resize — must still remove the document listeners and give
  // the body its cursor back.
  const dragCleanup = React.useRef<(() => void) | null>(null)
  React.useEffect(() => () => dragCleanup.current?.(), [])

  const maxWidth = maxPanelWidthFor(containerWidth)

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      const startX = event.clientX
      const startWidth = width
      setActive(true)

      let frame = 0
      let latest = startWidth
      const onMove = (moveEvent: PointerEvent) => {
        // Leftward travel is negative, and widening is what it should mean.
        latest = clampPanelWidth(startWidth - (moveEvent.clientX - startX), containerWidth)
        // Coalesced to one update per frame: a pointer emits far more events
        // than the screen can show, and each one here would re-render the
        // transcript beside it.
        if (frame) return
        frame = window.requestAnimationFrame(() => {
          frame = 0
          onWidthChange(latest)
        })
      }
      const teardown = () => {
        if (frame) window.cancelAnimationFrame(frame)
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        dragCleanup.current = null
      }
      const onUp = () => {
        onWidthChange(latest)
        teardown()
        setActive(false)
      }
      dragCleanup.current = teardown
      // On the document, not the handle: the pointer routinely outruns a 9px
      // strip, and a drag that stops when it does is a drag that fights back.
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [containerWidth, onWidthChange, width],
  )

  /**
   * Arrow keys move the edge too.
   *
   * A splitter that only answers to a pointer is unusable for anyone who does
   * not use one, and the separator role carries value semantics precisely so a
   * screen reader can say how wide it currently is (§33).
   */
  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 64 : 16
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onWidthChange(clampPanelWidth(width + step, containerWidth))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        onWidthChange(clampPanelWidth(width - step, containerWidth))
      } else if (event.key === 'Home') {
        event.preventDefault()
        onWidthChange(clampPanelWidth(maxWidth, containerWidth))
      } else if (event.key === 'End') {
        event.preventDefault()
        onWidthChange(clampPanelWidth(CHAT_PANEL_WIDTH.min, containerWidth))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        onReset()
      }
    },
    [containerWidth, maxWidth, onReset, onWidthChange, width],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      aria-label={t('chat.panel.resize', 'Resize panel')}
      title={t('chat.panel.resize', 'Resize panel')}
      aria-valuenow={width}
      aria-valuemin={CHAT_PANEL_WIDTH.min}
      aria-valuemax={Math.max(CHAT_PANEL_WIDTH.min, maxWidth)}
      data-active={active ? 'true' : undefined}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={(event) => {
        event.preventDefault()
        onReset()
      }}
      className={cn(
        // Wider than it looks: a 1px target is a target you miss. `touch-none`
        // keeps a stylus drag from scrolling the transcript underneath.
        'relative z-10 -mr-1 w-2 shrink-0 cursor-col-resize touch-none select-none outline-none',
        // The hairline IS the divider between the two panes, always drawn.
        'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border',
        'after:transition-colors',
        // Taking hold of it colours the line, so the edge answers the pointer
        // before the drag starts rather than only during it.
        'hover:after:bg-primary focus-visible:after:bg-primary data-[active=true]:after:bg-primary',
      )}
    />
  )
}
