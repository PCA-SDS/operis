'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InteractionSummary } from './types'
import { ActivityHistoryRow, ActivityHistoryYear, ActivityMeta, activityTimestamp, activityTypeLabel } from './ActivityHistoryParts'

interface ActivityTimelineProps {
  activities: InteractionSummary[]
  /** Shown when there is nothing to list; defaults to the no-match message. */
  emptyLabel?: string
  onEdit?: (activity: InteractionSummary) => void
  onMarkDone?: (activityId: string, updatedAt?: string | null) => void | Promise<void>
}

export function ActivityTimeline({ activities, emptyLabel, onEdit, onMarkDone }: ActivityTimelineProps) {
  const t = useT()

  if (activities.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        {emptyLabel ?? t('customers.timeline.empty', 'No activities match the current filters.')}
      </div>
    )
  }

  return (
    <ul>
      {activities.map((activity, index) => {
        const year = new Date(activityTimestamp(activity)).getFullYear()
        const previous = index > 0 ? activities[index - 1] : null
        const previousYear = previous ? new Date(activityTimestamp(previous)).getFullYear() : null
        const showYear = previousYear !== null && !Number.isNaN(year) && year !== previousYear
        return (
          <React.Fragment key={activity.id}>
            {showYear ? <ActivityHistoryYear year={year} /> : null}
            <TimelineEntry
              activity={activity}
              first={index === 0 || showYear}
              onEdit={onEdit}
              onMarkDone={onMarkDone}
            />
          </React.Fragment>
        )
      })}
    </ul>
  )
}

function TimelineEntry({
  activity,
  first,
  onEdit,
  onMarkDone,
}: {
  activity: InteractionSummary
  first: boolean
  onEdit?: (activity: InteractionSummary) => void
  onMarkDone?: (activityId: string, updatedAt?: string | null) => void | Promise<void>
}) {
  const t = useT()
  const [markingDone, setMarkingDone] = React.useState(false)
  const title = activity.title?.trim() || activityTypeLabel(activity.interactionType, t)

  const handleMarkDone = React.useCallback(async () => {
    if (!onMarkDone || markingDone) return
    setMarkingDone(true)
    try {
      await onMarkDone(activity.id, activity.updatedAt)
    } finally {
      setMarkingDone(false)
    }
  }, [activity.id, activity.updatedAt, markingDone, onMarkDone])

  return (
    <ActivityHistoryRow
      activity={activity}
      first={first}
      title={title}
      body={activity.body?.trim() || null}
      meta={<ActivityMeta activity={activity} />}
      onOpen={onEdit}
      onMarkDone={onMarkDone ? () => { void handleMarkDone() } : undefined}
      markingDone={markingDone}
    />
  )
}
