"use client"

import * as React from 'react'
import { Globe, MapPin } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { formatTimeLabel, formatTimeRangeLabel } from '../../lib/calendar/format'
import type { ResizeEdge } from '../../lib/calendar/grid'
import type { CalendarItem, CalendarPlatform } from './types'

// Height tiers. At ~48px/hour a 30-minute event is 24px tall, so the card has
// to shed content as it shrinks rather than overflow its box.
const SHOW_TIME_MIN_HEIGHT_PX = 30
const SHOW_META_MIN_HEIGHT_PX = 72
const WRAP_TITLE_MIN_HEIGHT_PX = 96
const MAX_VISIBLE_AVATARS = 3
const KEYBOARD_NUDGE_MINUTES = 15

const PLATFORM_LABELS: Record<CalendarPlatform, { key: string; fallback: string }> = {
  zoom: { key: 'customers.calendar.platform.zoom', fallback: 'Zoom' },
  meet: { key: 'customers.calendar.platform.meet', fallback: 'Meet' },
  slack: { key: 'customers.calendar.platform.slack', fallback: 'Slack' },
  teams: { key: 'customers.calendar.platform.teams', fallback: 'Teams' },
}

export type EventTone = {
  surfaceClassName: string
  titleClassName: string
  subClassName: string
  style?: React.CSSProperties
}

function softTintStyle(color: string): React.CSSProperties {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return { backgroundColor: `${color}1A`, borderInlineStartColor: color }
  return {
    backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
    borderInlineStartColor: color,
  }
}

export function resolveEventTone(item: CalendarItem, nowMs: number): EventTone {
  if (item.status === 'canceled') {
    return {
      surfaceClassName: 'bg-muted/60 border-s-muted-foreground/40',
      titleClassName: 'text-muted-foreground line-through',
      subClassName: 'text-muted-foreground/70',
    }
  }
  if (item.status === 'done' || item.end.getTime() < nowMs) {
    return {
      surfaceClassName: 'bg-muted border-s-muted-foreground/40',
      titleClassName: 'text-muted-foreground',
      subClassName: 'text-muted-foreground',
    }
  }
  if (item.color) {
    return {
      surfaceClassName: '',
      titleClassName: 'text-foreground',
      subClassName: 'text-muted-foreground',
      style: softTintStyle(item.color),
    }
  }
  return {
    surfaceClassName: 'bg-muted/60 border-s-primary',
    titleClassName: 'text-foreground',
    subClassName: 'text-muted-foreground',
  }
}

export function formatTimeRange(locale: string, start: Date, end: Date): string {
  return formatTimeRangeLabel(locale, start, end)
}

function participantLabel(participant: CalendarItem['participants'][number]): string {
  return participant.name ?? participant.email ?? '?'
}

type LocationMetaProps = {
  item: CalendarItem
  subClassName: string
  accentColor: string | null
}

function LocationMeta({ item, subClassName, accentColor }: LocationMetaProps) {
  const t = useT()
  if (!item.location || !item.locationKind) return null
  const iconStyle = accentColor ? { color: accentColor } : undefined
  if (item.locationKind === 'platform' && item.platform) {
    const platform = PLATFORM_LABELS[item.platform]
    return (
      <span className={cn('truncate text-xs', subClassName)}>
        {t('customers.calendar.grid.onPlatform', 'on {platform}', { platform: t(platform.key, platform.fallback) })}
      </span>
    )
  }
  if (item.locationKind === 'url') {
    return (
      <>
        <Globe className={cn('size-3.5 shrink-0', !accentColor && subClassName)} style={iconStyle} aria-hidden />
        <span className="truncate text-xs text-foreground">{item.location}</span>
      </>
    )
  }
  return (
    <>
      <MapPin className={cn('size-3.5 shrink-0', !accentColor && subClassName)} style={iconStyle} aria-hidden />
      <span className="truncate text-xs text-foreground">
        {t('customers.calendar.grid.venue', 'Venue: {name}', { name: item.location })}
      </span>
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
      <span className="block h-0.5 w-6 rounded-full bg-foreground/50" />
    </span>
  )
}

export type EventBlockProps = {
  item: CalendarItem
  top: number
  height: number
  insetInlineStart: string
  width: string
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
  const showTime = height >= SHOW_TIME_MIN_HEIGHT_PX
  const wrapTitle = height >= WRAP_TITLE_MIN_HEIGHT_PX
  const hasMetaContent = item.participants.length > 0 || (item.location !== null && item.locationKind !== null)
  const showMeta = height >= SHOW_META_MIN_HEIGHT_PX && hasMetaContent
  const visibleParticipants = item.participants.slice(0, MAX_VISIBLE_AVATARS)
  const overflowCount = item.participants.length - visibleParticipants.length
  const compact = !showTime

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

  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      aria-label={`${title}, ${timeRange}`}
      onKeyDown={onKeyDown}
      className={cn(
          'group pointer-events-auto absolute h-auto flex-col items-start justify-start gap-0.5 overflow-hidden whitespace-normal border-s-2 text-start outline-none',
          'transition-[filter,box-shadow] duration-150 hover:brightness-95',
          draggable && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
          compact ? 'flex-row items-center gap-1 px-1 py-0' : 'px-1.5 py-0.5',
          continuesBefore ? 'rounded-t-none' : 'rounded-t-md',
          continuesAfter ? 'rounded-b-none' : 'rounded-b-md',
          tone.surfaceClassName,
          conflicted && 'ring-1 ring-status-warning-icon',
          selected && 'shadow-md ring-2 ring-foreground',
          highlighted && 'motion-safe:animate-pulse',
          dragging && 'opacity-50',
          conflicted || highlighted || selected ? 'z-30' : 'z-10',
          'focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      style={{ top, height, insetInlineStart, width, ...tone.style }}
      {...buttonProps}
    >
        <span
          className={cn(
            'min-w-0 text-xs font-medium leading-tight',
            compact ? 'flex-1 truncate' : 'w-full',
            !compact && (wrapTitle ? 'line-clamp-2' : 'truncate'),
            tone.titleClassName,
          )}
        >
          {continuesBefore ? <span aria-hidden>‹ </span> : null}
          {title}
        </span>
        {compact ? (
          <span className={cn('shrink-0 text-overline tabular-nums', tone.subClassName)}>
            {formatTimeLabel(locale, item.start)}
          </span>
        ) : null}
        {showTime && !compact ? (
          <span className={cn('w-full truncate text-overline uppercase tracking-wide', tone.subClassName)}>
            {timeRange}
            {continuesAfter ? <span aria-hidden> ›</span> : null}
          </span>
        ) : null}
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
                  <span className={cn('shrink-0 text-xs', tone.subClassName)}>+{overflowCount}</span>
                ) : null}
              </>
            ) : null}
            <span className="ms-auto flex min-w-0 items-center gap-1.5">
              <LocationMeta item={item} subClassName={tone.subClassName} accentColor={item.color} />
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
