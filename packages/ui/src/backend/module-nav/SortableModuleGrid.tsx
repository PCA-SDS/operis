"use client"

import * as React from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

export type ModuleTileEntry = {
  key: string
  href: string
  name: string
  icon: React.ReactNode
}

export const MODULE_GRID_COLUMNS = 3

const TILE =
  'flex h-full select-none flex-col items-center gap-2 rounded-lg p-3 text-center text-xs font-medium transition-colors [-webkit-touch-callout:none] focus:outline-none focus-visible:shadow-focus'
const ICON_BOX = 'flex size-5 shrink-0 items-center justify-center [&_svg]:size-5'

/* Mouse starts a drag after 6px of travel, so a click still opens the module.
   Touch waits for a 250ms press, like a phone's home screen, so a swipe still
   scrolls the list. Keyboard picks up with Space only: Enter stays "open". */
const MOUSE_ACTIVATION = { distance: 6 }
const TOUCH_ACTIVATION = { delay: 250, tolerance: 8 }
const KEYBOARD_CODES = { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] }

/* The lifted tile must sit above the popover it came from (`z-popover`). */
const OVERLAY_LAYER: React.CSSProperties = { zIndex: 'var(--z-index-modal-elevated)' }

const DROP_ANIMATION: DropAnimation = {
  duration: 180,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } }),
}

const ARROW_STEPS: Record<string, number> = {
  ArrowRight: 1,
  ArrowLeft: -1,
  ArrowDown: MODULE_GRID_COLUMNS,
  ArrowUp: -MODULE_GRID_COLUMNS,
}

/**
 * Arrow keys move a lifted tile one place in reading order (Left, Right) or one
 * row (Up, Down). dnd-kit's sortable getter instead picks the neighbour by
 * comparing measured edges, and a tile resting exactly on a slot shares its edge
 * with the tiles in its own column and row, so a fraction of a pixel decides
 * whether Right lands beside it or below it. The grid's order is known, so this
 * moves by index and hands dnd-kit the target slot's corner.
 */
export function createGridKeyboardCoordinates(keys: readonly string[]): KeyboardCoordinateGetter {
  return (event, { active, context }) => {
    const step = ARROW_STEPS[event.code]
    if (step === undefined) return undefined
    event.preventDefault()
    const from = keys.indexOf(String(context.over?.id ?? active))
    const target = from >= 0 ? keys[from + step] : undefined
    const rect = target ? context.droppableRects.get(target) : undefined
    return rect ? { x: rect.left, y: rect.top } : undefined
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false)
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  return reduced
}

function TileFace({ entry }: { entry: ModuleTileEntry }) {
  return (
    <>
      <span aria-hidden="true" className={ICON_BOX}>
        {entry.icon}
      </span>
      <span className="line-clamp-2 break-words">{entry.name}</span>
    </>
  )
}

function SortableTile({
  entry,
  active,
  sortable,
  reducedMotion,
  suppressClickRef,
  onOpen,
}: {
  entry: ModuleTileEntry
  active: boolean
  sortable: boolean
  reducedMotion: boolean
  suppressClickRef: React.MutableRefObject<boolean>
  onOpen: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.key,
    disabled: !sortable,
    transition: reducedMotion ? null : { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  })
  const dragAttributes = { 'aria-describedby': attributes['aria-describedby'] }
  return (
    <div
      role="listitem"
      ref={setNodeRef}
      className={cn('min-w-0', isDragging && 'opacity-0')}
      style={{ transform: CSS.Translate.toString(transform), transition: transition ?? undefined }}
    >
      <Link
        href={entry.href}
        data-module-tile=""
        data-module-id={entry.key}
        aria-current={active ? 'page' : undefined}
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
        onClick={(event) => {
          if (suppressClickRef.current) {
            event.preventDefault()
            return
          }
          onOpen()
        }}
        className={cn(TILE, active ? 'text-primary' : 'text-foreground hover:text-primary')}
        {...(sortable ? dragAttributes : {})}
        {...(sortable ? listeners : {})}
      >
        <TileFace entry={entry} />
      </Link>
    </div>
  )
}

/**
 * The switcher's module tiles, reorderable like a phone's home screen.
 *
 * Tiles stay real links: a click opens the module, a drag moves it, and a
 * screen reader still announces a link. Of dnd-kit's drag attributes only the
 * reorder instructions are applied, not its button role, role description or
 * pressed state. While one is lifted the others slide out of its way and its old
 * place stays empty; the lifted copy follows the pointer in a portal (the
 * popover is transformed, so a fixed overlay inside it would be offset).
 *
 * The copy's slight enlargement sits on an inner element, so the box dnd-kit
 * measures for collisions and for the drop animation stays the tile's own and
 * the drop lands exactly on the slot. Screen readers get translated
 * instructions and live announcements for every pick-up, move and drop.
 */
export function SortableModuleGrid({
  entries,
  activeKey,
  sortable,
  label,
  onReorder,
  onOpen,
  onKeyDown,
  gridRef,
}: {
  entries: ModuleTileEntry[]
  activeKey: string | null
  sortable: boolean
  label: string
  onReorder: (keys: string[]) => void
  onOpen: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>, dragging: boolean) => void
  gridRef: React.RefObject<HTMLDivElement | null>
}) {
  const t = useT()
  const reducedMotion = usePrefersReducedMotion()
  const [draggingKey, setDraggingKey] = React.useState<UniqueIdentifier | null>(null)
  const suppressClickRef = React.useRef(false)
  const keys = React.useMemo(() => entries.map((entry) => entry.key), [entries])
  const keyboardCoordinates = React.useMemo(() => createGridKeyboardCoordinates(keys), [keys])
  const byKey = React.useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries])
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: MOUSE_ACTIVATION }),
    useSensor(TouchSensor, { activationConstraint: TOUCH_ACTIVATION }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates, keyboardCodes: KEYBOARD_CODES }),
  )

  const nameOf = (id: UniqueIdentifier) => byKey.get(String(id))?.name ?? String(id)
  const positionOf = (id: UniqueIdentifier | undefined) => (id === undefined ? 0 : keys.indexOf(String(id)) + 1)
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t('appShell.modules.dnd.pickedUp', 'Picked up {module}. Position {position} of {total}.', {
        module: nameOf(active.id),
        position: positionOf(active.id),
        total: keys.length,
      }),
    onDragOver: ({ active, over }) =>
      over
        ? t('appShell.modules.dnd.moved', '{module} moved to position {position} of {total}.', {
            module: nameOf(active.id),
            position: positionOf(over.id),
            total: keys.length,
          })
        : undefined,
    onDragEnd: ({ active, over }) =>
      t('appShell.modules.dnd.dropped', '{module} dropped at position {position} of {total}.', {
        module: nameOf(active.id),
        position: positionOf(over?.id ?? active.id),
        total: keys.length,
      }),
    onDragCancel: ({ active }) =>
      t('appShell.modules.dnd.cancelled', 'Reordering cancelled. {module} returned to position {position}.', {
        module: nameOf(active.id),
        position: positionOf(active.id),
      }),
  }

  const releaseClickGuard = () => {
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }

  const handleDragStart = (event: DragStartEvent) => {
    suppressClickRef.current = true
    setDraggingKey(event.active.id)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingKey(null)
    releaseClickGuard()
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = keys.indexOf(String(active.id))
    const to = keys.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onReorder(arrayMove(keys, from, to))
  }

  const handleDragCancel = () => {
    setDraggingKey(null)
    releaseClickGuard()
  }

  const dragging = draggingKey ? byKey.get(String(draggingKey)) ?? null : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: t(
            'appShell.modules.dnd.instructions',
            'To reorder, press Space to pick up a module, use the arrow keys to move it, then press Space or Enter to drop it. Press Escape to cancel.',
          ),
        },
      }}
    >
      <SortableContext items={keys} strategy={rectSortingStrategy} disabled={!sortable}>
        <div
          ref={gridRef}
          role="list"
          aria-label={label}
          data-dragging={dragging ? 'true' : undefined}
          className="grid grid-cols-3 gap-1"
          onKeyDown={(event) => onKeyDown(event, draggingKey !== null)}
        >
          {entries.map((entry) => (
            <SortableTile
              key={entry.key}
              entry={entry}
              active={entry.key === activeKey}
              sortable={sortable}
              reducedMotion={reducedMotion}
              suppressClickRef={suppressClickRef}
              onOpen={onOpen}
            />
          ))}
        </div>
      </SortableContext>
      {typeof document !== 'undefined'
        ? createPortal(
            <DragOverlay style={OVERLAY_LAYER} dropAnimation={reducedMotion ? null : DROP_ANIMATION}>
              {dragging ? (
                <div data-module-tile-overlay="" className="h-full">
                  <div
                    className={cn(TILE, 'cursor-grabbing bg-popover shadow-lg', dragging.key === activeKey ? 'text-primary' : 'text-foreground', !reducedMotion && 'scale-105')}
                  >
                    <TileFace entry={dragging} />
                  </div>
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )
        : null}
    </DndContext>
  )
}
