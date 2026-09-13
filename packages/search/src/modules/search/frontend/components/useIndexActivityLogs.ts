"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'

export type ActivityLog = {
  id: string
  source: string
  handler: string
  level: 'info' | 'error' | 'warn'
  entityType: string | null
  recordId: string | null
  message: string
  details: unknown
  occurredAt: string
}

type IndexStatusResponse = {
  logs?: ActivityLog[]
  errors?: ActivityLog[]
}

const MAX_ACTIVITY_LOGS = 50

export function isVectorActivityLog(log: ActivityLog): boolean {
  const lowerSource = log.source?.toLowerCase() ?? ''
  const lowerMessage = log.message?.toLowerCase() ?? ''
  const lowerHandler = log.handler?.toLowerCase() ?? ''
  return (
    lowerSource.includes('vector') ||
    lowerMessage.includes('vector') ||
    lowerMessage.includes('embedding') ||
    lowerHandler.includes('vector')
  )
}

export function useIndexActivityLogs(include: (log: ActivityLog) => boolean) {
  const [activityLogs, setActivityLogs] = React.useState<ActivityLog[]>([])
  const [activityLoading, setActivityLoading] = React.useState(true)
  const includeRef = React.useRef(include)
  includeRef.current = include

  const fetchActivityLogs = React.useCallback(async () => {
    setActivityLoading(true)
    try {
      const { ok, result: body } = await apiCall<IndexStatusResponse>('/api/query_index/status')
      if (ok && body) {
        const allLogs: ActivityLog[] = []
        if (body.logs) {
          allLogs.push(...body.logs)
        }
        if (body.errors) {
          allLogs.push(...body.errors.map((err) => ({ ...err, level: 'error' as const })))
        }
        const matching = allLogs.filter((log) => includeRef.current(log))
        matching.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
        setActivityLogs(matching.slice(0, MAX_ACTIVITY_LOGS))
      }
    } catch {
      // Silently fail
    } finally {
      setActivityLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchActivityLogs()
  }, [fetchActivityLogs])

  useAppEvent('progress.job.updated', () => {
    void fetchActivityLogs()
  }, [fetchActivityLogs])

  useAppEvent('progress.job.completed', () => {
    void fetchActivityLogs()
  }, [fetchActivityLogs])

  useAppEvent('om:bridge:reconnected', () => {
    void fetchActivityLogs()
  }, [fetchActivityLogs])

  return { activityLogs, activityLoading, fetchActivityLogs }
}
