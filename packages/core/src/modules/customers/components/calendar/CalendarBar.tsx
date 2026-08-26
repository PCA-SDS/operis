"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import type { AllDayBar } from '../../lib/calendar/layout'
import { eventDisplayTitle } from '../../lib/calendar/labels'
import { resolveEventTone } from './EventBlock'

/** Height of one bar row, shared by the week all-day lane and month rows. */
export const BAR_ROW_HEIGHT_PX = 20
export const BAR_ROW_GAP_PX = 2

export type CalendarBarProps = {
  bar: AllDayBar
  /** Number of day columns the bar is positioned across. */
  dayCount: number
  /** Accessible name; callers compose it so week and month read consistently. */
  label: string
  conflicted?: boolean
  highlighted?: boolean
  selected?: boolean
  dragging?: boolean
  nowMs: number
} & Omit<React.ComponentProps<typeof Button>, 'style' | 'children' | 'aria-label'>

/**
 * One continuous bar spanning the days an entry covers.
 *
 * Week view's all-day lane and month view's week rows render the same object,
 * so they share this component rather than drifting into two treatments of the
 * same thing.
 */
export const CalendarBar = React.forwardRef<HTMLButtonElement, CalendarBarProps>(function CalendarBar(
  { bar, dayCount, label, conflicted, highlighted, selected, dragging, nowMs, className, ...buttonProps },
  ref,
) {
  const t = useT()
  const tone = resolveEventTone(bar.item, nowMs)
  const title = eventDisplayTitle(bar.item.title, t('customers.calendar.grid.untitled', 'Untitled'))
  const spanDays = bar.endIndex - bar.startIndex + 1

  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      aria-label={label}
      className={cn(
        'absolute h-auto min-w-0 justify-start gap-1 truncate px-2 py-0 text-start text-xs font-medium transition-[filter,box-shadow]',
        'hover:brightness-95',
        bar.continuesBefore ? 'rounded-s-none' : 'rounded-s-sm',
        bar.continuesAfter ? 'rounded-e-none' : 'rounded-e-sm',
        tone.surfaceClassName,
        tone.titleClassName,
        conflicted && 'ring-1 ring-status-warning-icon',
        selected && 'ring-2 ring-foreground',
        highlighted && 'motion-safe:animate-pulse',
        dragging && 'opacity-50',
        'focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      style={{
        insetInlineStart: `calc(${(bar.startIndex / dayCount) * 100}% + 2px)`,
        width: `calc(${(spanDays / dayCount) * 100}% - 4px)`,
        top: bar.lane * (BAR_ROW_HEIGHT_PX + BAR_ROW_GAP_PX),
        height: BAR_ROW_HEIGHT_PX,
        ...tone.style,
      }}
      {...buttonProps}
    >
      {bar.continuesBefore ? (
        <span aria-hidden className="shrink-0 opacity-60">
          ‹
        </span>
      ) : null}
      <span className="min-w-0 truncate">{title}</span>
      {bar.continuesAfter ? (
        <span aria-hidden className="ms-auto shrink-0 opacity-60">
          ›
        </span>
      ) : null}
    </Button>
  )
})

CalendarBar.displayName = 'CalendarBar'
