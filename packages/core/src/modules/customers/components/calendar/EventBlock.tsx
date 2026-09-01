"use client"

import * as React from 'react'
import { Globe, MapPin } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { formatTimeLabel, formatTimeRangeLabel } from '../../lib/calendar/format'
import type { ResizeEdge } from '../../lib/calendar/grid'
import { resolveEventTone } from '../../lib/calendar/tone'
import type { CalendarItem, CalendarPlatform } from './types'

/**
 * Height tiers. At 48px/hour a 30-minute event is 24px tall, so a card sheds
 * content as it shrinks — title and time share one line, then the time drops to
 * its own line, then meta appears — rather than overflowing its box.
 */
const ONE_LINE_MAX_HEIGHT_PX = 27
const SHOW_META_MIN_HEIGHT_PX = 74
const WRAP_TITLE_MIN_HEIGHT_PX = 92
const MAX_VISIBLE_AVATARS = 3
const KEYBOARD_NUDGE_MINUTES = 15

const PLATFORM_LABELS: Record<CalendarPlatform, { key: string; fallback: string }> = {
  zoom: { key: 'customers.calendar.platform.zoom', fallback: 'Zoom' },
  meet: { key: 'customers.calendar.platform.meet', fallback: 'Meet' },
  slack: { key: 'customers.calendar.platform.slack', fallback: 'Slack' },
  teams: { key: 'customers.calendar.platform.teams', fallback: 'Teams' },
}

export { resolveEventTone }
export type { EventTone } from '../../lib/calendar/tone'

export function formatTimeRange(locale: string, start: Date, end: Date): string {
  return formatTimeRangeLabel(locale, start, end)
}

function participantLabel(participant: CalendarItem['participants'][number]): string {
  return participant.name ?? participant.email ?? '?'
}

type LocationMetaProps = {
  item: CalendarItem
  subClassName: string
}

function LocationMeta({ item, subClassName }: LocationMetaProps) {
  const t = useT()
  if (!item.location || !item.locationKind) return null
  if (item.locationKind === 'platform' && item.platform) {
    const platform = PLATFORM_LABELS[item.platform]
    return (
      <span className={cn('truncate text-xs font-normal', subClassName)}>
        {t('customers.calendar.grid.onPlatform', 'on {platform}', { platform: t(platform.key, platform.fallback) })}
      </span>
    )
  }
  const Icon = item.locationKind === 'url' ? Globe : MapPin
  const label =
    item.locationKind === 'url'
      ? item.location
      : t('customers.calendar.grid.venue', 'Venue: {name}', { name: item.location })
  return (
    <>
      <Icon className={cn('size-3 shrink-0', subClassName)} aria-hidden />
      <span className={cn('truncate text-xs font-normal', subClassName)}>{label}</span>
    </>
  )
}

type ResizeHandleProps = {
  edge: ResizeEdge
  label: string
  onResizeStart(edge: ResizeEdge, event: React.PointerEvent<HTMLElement>): void
}

/**
 * A non-interactive element so it can live inside the block's button without
 * nesting interactive content. Keyboard users resize with the block's own
 * shortcuts instead — see `onKeyDown` below.
 */
function ResizeHandle({ edge, label, onResizeStart }: ResizeHandleProps) {
  return (
    <span
      aria-hidden
      title={label}
      onPointerDown={(event) => onResizeStart(edge, event)}
      className={cn(
        'absolute inset-x-0 z-40 flex h-2 items-center justify-center opacity-0 transition-opacity',
        'cursor-ns-resize hover:opacity-100 group-focus-visible:opacity-100 group-hover:opacity-100',
        edge === 'start' ? 'top-0' : 'bottom-0',
      )}
    >
      <span className="block h-0.5 w-6 rounded-full bg-current opacity-70" />
    </span>
  )
}

export type EventBlockProps = {
  item: CalendarItem
  top: number
  height: number
  insetInlineStart: string
  width: string
  /** Position within its overlap cluster; later cards paint above earlier ones. */
  stackIndex?: number
  conflicted: boolean
  highlighted: boolean
  selected?: boolean
  continuesBefore?: boolean
  continuesAfter?: boolean
  resizable?: boolean
  /** Enables the grab affordance; the gesture itself lives in the grid. */
  draggable?: boolean
  dragging?: boolean
  nowMs: number
  onResizeStart?(edge: ResizeEdge, event: React.PointerEvent<HTMLElement>): void
  /** Keyboard nudge: shift the whole event, or extend its end, by `minutes`. */
  onNudge?(item: CalendarItem, minutes: number, mode: 'move' | 'resize'): void
} & Omit<React.ComponentProps<typeof Button>, 'style' | 'children'>

export const EventBlock = React.forwardRef<HTMLButtonElement, EventBlockProps>(function EventBlock(
  {
    item,
    top,
    height,
    insetInlineStart,
    width,
    stackIndex = 0,
    conflicted,
    highlighted,
    selected,
    continuesBefore = false,
    continuesAfter = false,
    resizable = false,
    draggable = false,
    dragging = false,
    nowMs,
    onResizeStart,
    onNudge,
    className,
    ...buttonProps
  },
  ref,
) {
  const t = useT()
  const locale = useLocale()
  const tone = resolveEventTone(item, nowMs)
  const title = item.title || t('customers.calendar.grid.untitled', 'Untitled')
  const timeRange = formatTimeRange(locale, item.start, item.end)
  const oneLine = height <= ONE_LINE_MAX_HEIGHT_PX
  const wrapTitle = height >= WRAP_TITLE_MIN_HEIGHT_PX
  const hasMetaContent = item.participants.length > 0 || (item.location !== null && item.locationKind !== null)
  const showMeta = height >= SHOW_META_MIN_HEIGHT_PX && hasMetaContent
  const visibleParticipants = item.participants.slice(0, MAX_VISIBLE_AVATARS)
  const overflowCount = item.participants.length - visibleParticipants.length

  // Arrow keys move the event, Shift+Arrow resizes it, so every pointer gesture
  // has a keyboard equivalent.
  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!onNudge || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      if (event.altKey || event.metaKey || event.ctrlKey) return
      event.preventDefault()
      const direction = event.key === 'ArrowUp' ? -1 : 1
      onNudge(item, direction * KEYBOARD_NUDGE_MINUTES, event.shiftKey ? 'resize' : 'move')
    },
    [item, onNudge],
  )

  // Later columns paint above earlier ones, so the 2px gutter between two
  // concurrent cards never lets the earlier one clip the later one's edge.
  // Selection and conflict still outrank position.
  const stackZ = 10 + Math.min(stackIndex, 8)
  const raisedZ = conflicted || highlighted || selected ? 30 : stackZ

  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      aria-label={`${title}, ${timeRange}`}
      onKeyDown={onKeyDown}
      className={cn(
        'group pointer-events-auto absolute h-auto items-start justify-start overflow-hidden whitespace-normal text-start outline-none',
        'transition-[box-shadow,filter] duration-100 hover:brightness-95 hover:shadow-sm',
        draggable && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
        oneLine ? 'flex-row items-center gap-1 px-1.5 py-0' : 'flex-col gap-px px-1.5 py-0.5',
        continuesBefore ? 'rounded-t-none' : 'rounded-t',
        continuesAfter ? 'rounded-b-none' : 'rounded-b',
        tone.surfaceClassName,
        conflicted && 'ring-1 ring-status-warning-icon',
        selected && 'shadow-md ring-2 ring-foreground',
        highlighted && 'motion-safe:animate-pulse',
        dragging && 'opacity-50',
        'focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      style={{ top, height, insetInlineStart, width, zIndex: raisedZ, ...tone.style }}
      {...buttonProps}
    >
      <span
        className={cn(
          'min-w-0 text-xs font-medium leading-tight',
          oneLine ? 'shrink truncate' : 'w-full',
          !oneLine && (wrapTitle ? 'line-clamp-2' : 'truncate'),
          tone.titleClassName,
        )}
      >
        {continuesBefore ? <span aria-hidden>‹ </span> : null}
        {title}
      </span>
      {/* A short event keeps its start time on the title's line, which is how a
          calendar keeps a 30-minute slot readable. */}
      {oneLine ? (
        <span className={cn('shrink-0 truncate text-xs font-normal leading-tight tabular-nums', tone.subClassName)}>
          {formatTimeLabel(locale, item.start)}
        </span>
      ) : (
        <span className={cn('w-full truncate text-xs font-normal leading-tight tabular-nums', tone.subClassName)}>
          {timeRange}
          {continuesAfter ? <span aria-hidden> ›</span> : null}
        </span>
      )}
      {showMeta ? (
        <span className="mt-auto flex w-full min-w-0 items-center gap-1.5">
          {visibleParticipants.length > 0 ? (
            <>
              <AvatarStack size="xs" max={MAX_VISIBLE_AVATARS} className="shrink-0 gap-px [&>*:not(:first-child)]:-ml-1">
                {visibleParticipants.map((participant) => (
                  <Avatar key={participant.userId} size="xs" label={participantLabel(participant)} />
                ))}
              </AvatarStack>
              {overflowCount > 0 ? (
                <span className={cn('shrink-0 text-xs font-normal', tone.subClassName)}>+{overflowCount}</span>
              ) : null}
            </>
          ) : null}
          <span className="ms-auto flex min-w-0 items-center gap-1">
            <LocationMeta item={item} subClassName={tone.subClassName} />
          </span>
        </span>
      ) : null}
      {resizable && onResizeStart ? (
        <>
          {!continuesBefore ? (
            <ResizeHandle
              edge="start"
              label={t('customers.calendar.grid.resizeStart', 'Change start time')}
              onResizeStart={onResizeStart}
            />
          ) : null}
          {!continuesAfter ? (
            <ResizeHandle
              edge="end"
              label={t('customers.calendar.grid.resizeEnd', 'Change end time')}
              onResizeStart={onResizeStart}
            />
          ) : null}
        </>
      ) : null}
    </Button>
  )
})

EventBlock.displayName = 'EventBlock'
