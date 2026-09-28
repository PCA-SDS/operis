"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SkeletonBar, SkeletonRegion } from '@open-mercato/ui/backend/skeletons/PageSkeletons'
import { CalendarSkeleton } from './CalendarSkeleton'
import { useAvailableHeight } from './useAvailableHeight'

/** The same floor `CalendarScreen` gives its grid. */
const MIN_GRID_HEIGHT_PX = 320

/**
 * The calendar page while the route loads: the page's `fill` frame and
 * `CalendarScreen`'s own column, bar and grid area, with the grid drawn by the
 * `CalendarSkeleton` the screen shows for its first fetch. The bar keeps
 * `CalendarHeader`'s clusters at the widths of their controls and every
 * control's 36px box, so the real bar lands on it without moving. The screen
 * always opens on Week, so that is the grid drawn here. Without the `fill`
 * frame the grid was held to the shell's column and came up 32px short of the
 * height the screen measures.
 */
export function CalendarPageSkeleton() {
  const gridRef = React.useRef<HTMLDivElement | null>(null)
  const gridHeight = useAvailableHeight(gridRef, MIN_GRID_HEIGHT_PX)
  return (
    <Page fill="md">
      <PageBody fill="md">
        <SkeletonRegion className="flex h-full min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-3">
            <div className="flex min-w-0 flex-1 basis-90 items-center gap-2">
              <SkeletonBar className="h-9 w-17.5 rounded-lg" />
              <SkeletonBar className="size-9 rounded-lg" />
              <SkeletonBar className="size-9 rounded-lg" />
              <span aria-hidden="true" className="flex min-w-0 items-center text-lg leading-tight sm:text-xl">
                &#8203;
                <SkeletonBar className="h-5 w-40" />
              </span>
            </div>
            <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
              <SkeletonBar className="h-9 w-30 rounded-lg" />
              <SkeletonBar className="h-9 w-36 rounded-lg" />
              <SkeletonBar className="h-9 w-44.5 rounded-lg" />
            </div>
          </div>
          <div
            ref={gridRef}
            className="flex min-h-80 flex-1 flex-col overflow-hidden"
            style={gridHeight === null ? undefined : { height: gridHeight, maxHeight: gridHeight }}
          >
            <CalendarSkeleton view="week" columns={7} />
          </div>
        </SkeletonRegion>
      </PageBody>
    </Page>
  )
}
