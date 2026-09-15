"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { ScheduleView, type ScheduleItem, type ScheduleRange } from '@open-mercato/ui/backend/schedule'
import { Button } from '@open-mercato/ui/primitives/button'

type Assignment = {
  id: string
  resourceId: string
  state: 'draft' | 'confirmed'
  startsAt: string
  endsAt: string
  assignedMemberId?: string | null
  assignedMemberName?: string | null
  title?: string | null
  sourceModule: string
  sourceEntityType: string
  sourceEntityId: string
  createdAt: string
  updatedAt: string
}

type AssignmentsResponse = {
  resourceId: string
  startsAt: string
  endsAt: string
  assignments: Assignment[]
}

interface ResourceBookingsSectionProps {
  resourceId: string
}

export function ResourceBookingsSection({ resourceId }: ResourceBookingsSectionProps) {
  const t = useT()
  const [assignments, setAssignments] = React.useState<Assignment[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [scheduleItems, setScheduleItems] = React.useState<ScheduleItem[]>([])
  const [scheduleRange, setScheduleRange] = React.useState<ScheduleRange>(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    return { start, end }
  })

  // Load assignments
  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function load() {
      setIsLoading(true)
      setError(null)

      try {
        const data = await readApiResultOrThrow<AssignmentsResponse>(
          `/api/resources/resources/${encodeURIComponent(resourceId)}/assignments?startsAt=${scheduleRange.start.toISOString()}&endsAt=${scheduleRange.end.toISOString()}&includeDraft=true`,
          { signal: controller.signal },
        )

        if (!cancelled && data) {
          setAssignments(data.assignments)
          buildScheduleItems(data.assignments)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load bookings')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [resourceId, scheduleRange.start.toISOString(), scheduleRange.end.toISOString()])

  // Build schedule items from assignments
  function buildScheduleItems(items: Assignment[]) {
    const scheduleItems: ScheduleItem[] = items.map((assignment) => ({
      id: assignment.id,
      kind: 'event' as const,
      title: `${assignment.title || 'Booking'} (${assignment.state === 'confirmed' ? 'Confirmed' : 'Draft'})`,
      startsAt: new Date(assignment.startsAt),
      endsAt: new Date(assignment.endsAt),
      status: assignment.state,
      subjectType: 'resource' as const,
      subjectId: assignment.resourceId,
      color: assignment.state === 'confirmed' ? '#22c55e' : '#eab308',
      metadata: {
        sourceModule: assignment.sourceModule,
        sourceEntityType: assignment.sourceEntityType,
        sourceEntityId: assignment.sourceEntityId,
        assignedMemberName: assignment.assignedMemberName,
      },
    }))

    setScheduleItems(scheduleItems)
  }

  // Handle range change
  const handleRangeChange = React.useCallback((range: ScheduleRange) => {
    setScheduleRange(range)
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">{t('common.loading', 'Loading...')}</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <p className="text-destructive mb-4">{error}</p>
        <Button variant="outline" size="sm" onClick={() => setScheduleRange({ ...scheduleRange })}>
          {t('common.retry', 'Retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span>{assignments.filter((a) => a.state === 'confirmed').length} {t('resources.bookings.confirmed', 'Confirmed')}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-yellow-500" />
          <span>{assignments.filter((a) => a.state === 'draft').length} {t('resources.bookings.draft', 'Draft')}</span>
        </div>
      </div>

      {/* Schedule */}
      <ScheduleView
        items={scheduleItems}
        view="week"
        range={scheduleRange}
        timezone={Intl.DateTimeFormat().resolvedOptions().timeZone}
        onRangeChange={handleRangeChange}
        onViewChange={() => {}}
      />

      {/* Assignment list */}
      {assignments.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{t('resources.bookings.list', 'Upcoming Bookings')}</h4>
          <div className="divide-y rounded-lg border">
            {assignments
              .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
              .slice(0, 10)
              .map((assignment) => (
                <div key={assignment.id} className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-2 w-2 rounded-full ${
                        assignment.state === 'confirmed' ? 'bg-green-500' : 'bg-yellow-500'
                      }`}
                    />
                    <div>
                      <div className="text-sm font-medium">
                        {assignment.title || `${assignment.sourceModule}: ${assignment.sourceEntityType}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(assignment.startsAt).toLocaleString()} - {new Date(assignment.endsAt).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                  {assignment.assignedMemberName && (
                    <span className="text-xs text-muted-foreground">{assignment.assignedMemberName}</span>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
