"use client"

import * as React from 'react'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@open-mercato/ui/primitives/sheet'
import {
  ScheduleView,
  type ScheduleItem,
  type ScheduleRange,
  type ScheduleViewMode,
} from '@open-mercato/ui/backend/schedule'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TaskCalendarItemDto, TaskCalendarMode } from '../data/types'
import { TaskPanel } from './TaskPanel'
import { ErrorState } from './ui-bits'
import { TASK_STATUS_META, browserTimeZone, taskRef } from './format'
import { useTaskCalendar, useTaskError } from './hooks'

/** A task without a wall-clock time occupies a nominal hour on the grid; an
 *  all-day lane would be an extra concept for something that is really "some
 *  time that day". */
const DEFAULT_SLOT_MINUTES = 60

function isoDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function startOfMonthGrid(reference: Date): ScheduleRange {
  const start = new Date(reference.getFullYear(), reference.getMonth(), 1)
  const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 0)
  return { start, end }
}

function toScheduleItem(task: TaskCalendarItemDto): ScheduleItem {
  const [hour, minute] = (task.calendarTime ?? '09:00').split(':').map(Number)
  const [year, month, day] = task.calendarDate.split('-').map(Number)
  const startsAt = new Date(year!, (month ?? 1) - 1, day ?? 1, hour ?? 9, minute ?? 0)
  const endsAt = new Date(startsAt.getTime() + DEFAULT_SLOT_MINUTES * 60_000)
  return {
    id: task.id,
    kind: 'event',
    title: task.title,
    startsAt,
    endsAt,
    color: TASK_STATUS_META[task.status].colorVar,
    metadata: {
      projectId: task.projectId,
      reference: taskRef(task.projectKey, task.number),
      projectName: task.projectName,
    },
  }
}

/**
 * The calendar drawer over the caller's own tasks.
 *
 * Two readings of the same data: `scheduled` places a task on the day it is due
 * (the plan), `done` on the day it was finished (the record). Keeping them as
 * modes rather than two screens makes "did I do what I planned?" one toggle.
 */
export function CalendarPanel({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [view, setView] = React.useState<ScheduleViewMode>('month')
  const [mode, setMode] = React.useState<TaskCalendarMode>('scheduled')
  const [range, setRange] = React.useState<ScheduleRange>(() => startOfMonthGrid(new Date()))
  const [search, setSearch] = React.useState('')
  const [selected, setSelected] = React.useState<{ id: string; projectId: string } | null>(null)

  const { data, isLoading, error, retry } = useTaskCalendar({
    mode,
    from: isoDay(range.start),
    to: isoDay(range.end),
    search,
  })
  const errorMessage = useTaskError(error, t('tasks.common.loadFailed', "This didn't load"))

  const items = React.useMemo(() => data?.items ?? [], [data?.items])
  const scheduleItems = React.useMemo(() => items.map(toScheduleItem), [items])
  const isEmpty = !isLoading && !errorMessage && items.length === 0

  return (
    <>
      <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 sm:max-w-[64rem]"
          closeLabel={t('tasks.calendar.close', 'Close calendar')}
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>{t('tasks.calendar.title', 'Calendar')}</SheetTitle>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4">
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder={t('tasks.calendar.searchPlaceholder', 'Search tasks…')}
                aria-label={t('tasks.calendar.searchLabel', 'Search calendar tasks')}
                className="w-40 sm:w-52"
              />
              <SegmentedControl
                value={mode}
                onValueChange={(value) => setMode(value as TaskCalendarMode)}
                aria-label={t('tasks.calendar.modeLabel', 'Which date places a task')}
              >
                <SegmentedControlItem value="scheduled">
                  {t('tasks.calendar.mode.scheduled', 'Scheduled')}
                </SegmentedControlItem>
                <SegmentedControlItem value="done">
                  {t('tasks.calendar.mode.done', 'Done')}
                </SegmentedControlItem>
              </SegmentedControl>
            </div>

            {errorMessage ? (
              <ErrorState message={errorMessage} onRetry={retry} size="lg" />
            ) : (
              <div className="min-h-0 flex-1">
                <ScheduleView
                  items={scheduleItems}
                  view={view}
                  range={range}
                  timezone={browserTimeZone()}
                  onViewChange={setView}
                  onRangeChange={setRange}
                  onItemClick={(item) => {
                    const projectId = item.metadata?.projectId
                    if (typeof projectId === 'string') setSelected({ id: item.id, projectId })
                  }}
                />
              </div>
            )}

            {!errorMessage && data?.truncated && (
              <p className="shrink-0 px-1 text-xs text-muted-foreground">
                {t(
                  'tasks.calendar.truncated',
                  'Showing the first tasks in this window. Narrow the range or search to see the rest.',
                )}
              </p>
            )}

            {isEmpty && !data?.truncated && (
              <div className="shrink-0">
                <EmptyState
                  variant="subtle"
                  size="sm"
                  title={
                    mode === 'scheduled'
                      ? t('tasks.calendar.emptyScheduled', 'Nothing due in this window')
                      : t('tasks.calendar.emptyDone', 'Nothing completed in this window')
                  }
                  description={
                    mode === 'scheduled'
                      ? t('tasks.calendar.emptyScheduledHint', 'Give a task a due date and it lands here.')
                      : t('tasks.calendar.emptyDoneHint', 'Finish a task in this range and it lands here.')
                  }
                />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {selected && (
        <TaskPanel
          taskId={selected.id}
          projectId={selected.projectId}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}
