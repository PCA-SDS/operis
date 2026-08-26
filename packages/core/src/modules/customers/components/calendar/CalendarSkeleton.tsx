"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import type { CalendarView } from './types'

const SKELETON_HOURS = 12
const MONTH_CELLS = 42
const SKELETON_BLOCKS = [
  { column: 0, top: 1, span: 2 },
  { column: 1, top: 3, span: 1 },
  { column: 2, top: 2, span: 3 },
  { column: 4, top: 5, span: 2 },
  { column: 5, top: 1, span: 1 },
]

/**
 * Keeps the grid's shape while the window loads, so navigating between ranges
 * never blanks the page. Placeholders come from the design-system `Skeleton`
 * so the calendar pulses at the same rate as the rest of the app.
 */
export function CalendarSkeleton({ view, columns }: { view: CalendarView; columns: number }) {
  const t = useT()
  const label = t('customers.calendar.loading', 'Loading calendar…')

  if (view === 'month') {
    return (
      <div
        aria-busy="true"
        aria-label={label}
        className="grid h-full w-full grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border"
      >
        {Array.from({ length: MONTH_CELLS }, (_, index) => (
          <div key={index} className="flex flex-col gap-1 bg-surface p-2">
            <Skeleton shape="circle" className="size-5" aria-hidden />
            {index % 3 === 0 ? <Skeleton className="h-3 w-full" aria-hidden /> : null}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      aria-busy="true"
      aria-label={label}
      className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex shrink-0 border-b border-border">
        <div className="w-14 shrink-0 border-e border-border md:w-20" />
        {Array.from({ length: columns }, (_, index) => (
          <div
            key={index}
            className="flex flex-1 flex-col items-center gap-1 border-e border-border py-2 last:border-e-0"
          >
            <Skeleton className="h-2 w-8" aria-hidden />
            <Skeleton shape="circle" className="size-6" aria-hidden />
          </div>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-14 shrink-0 flex-col border-e border-border md:w-20">
          {Array.from({ length: SKELETON_HOURS }, (_, index) => (
            <div key={index} className="flex flex-1 items-start justify-end pe-2 pt-1">
              <Skeleton className="h-2 w-6" aria-hidden />
            </div>
          ))}
        </div>
        <div className="relative flex min-w-0 flex-1">
          {Array.from({ length: columns }, (_, index) => (
            <div key={index} className="relative min-w-0 flex-1 border-e border-border last:border-e-0">
              {Array.from({ length: SKELETON_HOURS }, (_, hour) => (
                <div
                  key={hour}
                  className="border-b border-border/70"
                  style={{ height: `${100 / SKELETON_HOURS}%` }}
                />
              ))}
            </div>
          ))}
          <div className="absolute inset-0 flex">
            {Array.from({ length: columns }, (_, column) => (
              <div key={column} className="relative min-w-0 flex-1">
                {SKELETON_BLOCKS.filter((block) => block.column === column).map((block) => (
                  <Skeleton
                    key={`${block.column}-${block.top}`}
                    aria-hidden
                    className="absolute inset-x-1"
                    style={{
                      top: `${(block.top / SKELETON_HOURS) * 100}%`,
                      height: `${(block.span / SKELETON_HOURS) * 100}%`,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
