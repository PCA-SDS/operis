"use client"
import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import { useAppEvent } from '../injection/useAppEvent'
import { useTabRestoreRefresh, useVisibilityAwareInterval } from '../utils/backgroundPolling'
import { subscribeProgressUpdate } from '@open-mercato/shared/lib/frontend/progressEvents'
import type { ProgressJobDto, UseProgressPollResult } from './useProgressPoll'
import { applyLocalProgressUpdate, isLocalProgressJob } from './useProgressPoll'

// Reconciliation safety net for jobs already in flight — SSE (`progress.job.*`)
// is the primary channel, this only repairs a dropped frame. It is gated on
// `activeJobs.length > 0` so an idle tab issues zero periodic requests.
const SSE_PROGRESS_SYNC_INTERVAL = 5000
// A single job emits `created` then `started` back to back; debouncing collapses
// that burst into one `/api/progress/active` read.
const SSE_PROGRESS_EVENT_DEBOUNCE = 250

function isVisibleProgressJob(job: ProgressJobDto): boolean {
  return job.meta?.hiddenFromTopBar !== true
}

function isActiveStatus(status: ProgressJobDto['status']): boolean {
  return status === 'pending' || status === 'running'
}

function isTerminalStatus(status: ProgressJobDto['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function upsertJob(list: ProgressJobDto[], job: ProgressJobDto): ProgressJobDto[] {
  if (!isVisibleProgressJob(job)) {
    return list.filter((item) => item.id !== job.id)
  }
  const next = [job, ...list.filter((item) => item.id !== job.id)]
  return next.sort(
    (a, b) =>
      new Date(b.startedAt ?? b.finishedAt ?? 0).getTime()
      - new Date(a.startedAt ?? a.finishedAt ?? 0).getTime(),
  )
}

export function useProgressSse(): UseProgressPollResult {
  const [activeJobs, setActiveJobs] = React.useState<ProgressJobDto[]>([])
  const [recentlyCompleted, setRecentlyCompleted] = React.useState<ProgressJobDto[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchJobs = React.useCallback(async () => {
    try {
      const result = await apiCall<{ active: ProgressJobDto[]; recentlyCompleted: ProgressJobDto[] }>(
        '/api/progress/active',
      )
      if (result.ok && result.result) {
        setActiveJobs((prev) => [
          ...prev.filter((job) => isLocalProgressJob(job) && isActiveStatus(job.status)),
          ...result.result!.active.filter(isVisibleProgressJob),
        ])
        setRecentlyCompleted((prev) => [
          ...prev.filter((job) => isLocalProgressJob(job) && isTerminalStatus(job.status)),
          ...result.result!.recentlyCompleted.filter(isVisibleProgressJob),
        ].slice(0, 10))
        setError(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch progress')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const cancelScheduledFetch = React.useCallback(() => {
    if (debounceTimerRef.current === null) return
    clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = null
  }, [])

  const scheduleFetch = React.useCallback(() => {
    if (debounceTimerRef.current !== null) return
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void fetchJobs()
    }, SSE_PROGRESS_EVENT_DEBOUNCE)
  }, [fetchJobs])

  const fetchNow = React.useCallback(() => {
    cancelScheduledFetch()
    void fetchJobs()
  }, [cancelScheduledFetch, fetchJobs])

  const refresh = React.useCallback(() => {
    fetchNow()
  }, [fetchNow])

  React.useEffect(() => cancelScheduledFetch, [cancelScheduledFetch])

  React.useEffect(() => {
    void fetchJobs()
  }, [fetchJobs])

  useVisibilityAwareInterval(fetchNow, SSE_PROGRESS_SYNC_INTERVAL, activeJobs.length > 0)

  useTabRestoreRefresh(fetchNow)

  React.useEffect(() => {
    return subscribeProgressUpdate((detail) => {
      applyLocalProgressUpdate(detail, setActiveJobs, setRecentlyCompleted)
    })
  }, [])

  useAppEvent(
    'progress.job.updated',
    (event) => {
      const payload = event.payload as Partial<ProgressJobDto> & { jobId?: string }
      const jobId = payload?.jobId
      if (!jobId) {
        scheduleFetch()
        return
      }
      const status = (payload.status as ProgressJobDto['status']) ?? 'running'
      const job: ProgressJobDto = {
        id: jobId,
        jobType: payload.jobType ?? 'progress',
        name: payload.name ?? payload.jobType ?? 'Progress job',
        description: payload.description ?? null,
        meta: (payload.meta && typeof payload.meta === 'object') ? payload.meta as Record<string, unknown> : null,
        status,
        progressPercent: payload.progressPercent ?? 0,
        processedCount: payload.processedCount ?? 0,
        totalCount: payload.totalCount ?? null,
        etaSeconds: payload.etaSeconds ?? null,
        cancellable: payload.cancellable ?? false,
        startedAt: payload.startedAt ?? null,
        finishedAt: payload.finishedAt ?? null,
        errorMessage: payload.errorMessage ?? null,
      }

      if (isTerminalStatus(status)) {
        setActiveJobs((prev) => prev.filter((item) => item.id !== jobId))
        setRecentlyCompleted((prev) => upsertJob(prev, job).slice(0, 10))
        return
      }

      setActiveJobs((prev) => upsertJob(prev, job))
    },
    [scheduleFetch],
  )

  // `created`, `started`, `completed`, `failed` and `cancelled` all mean the same
  // thing here — the server-side job set moved — so they share one debounced read
  // instead of the five back-to-back refetches they used to trigger. `updated`
  // is handled above from its own payload and must not refetch.
  useAppEvent(
    'progress.job.*',
    (event) => {
      if (event.id === 'progress.job.updated') return
      scheduleFetch()
    },
    [scheduleFetch],
  )

  useAppEvent('om:bridge:reconnected', () => {
    fetchNow()
  }, [fetchNow])

  return { activeJobs, recentlyCompleted, isLoading, error, refresh }
}
