"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import { isSameDay } from 'date-fns/isSameDay'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { matchFeature } from '@open-mercato/shared/lib/auth/featureMatch'
import {
  buildOptimisticLockHeader,
  extractOptimisticLockConflict,
} from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { countByCategory } from '../../lib/calendar/categories'
import { findConflicts } from '../../lib/calendar/conflicts'
import { getVisibleRange, shiftAnchor } from '../../lib/calendar/range'
import { resolveJoinUrl } from '../../lib/calendar/mapItem'
import {
  calendarTimeZone,
  formatCalendarDate,
  formatWallClockTime,
  taskScheduleChangeFor,
} from '../../lib/calendar/taskItem'
import { AgendaList } from './AgendaList'
import { CalendarSkeleton } from './CalendarSkeleton'
import { CalendarHeader } from './CalendarHeader'
import { CalendarScopeBar } from './CalendarScopeBar'
import { CalendarToolbar } from './CalendarToolbar'
import { MonthGrid } from './MonthGrid'
import { TimeGrid } from './TimeGrid'
import { UpcomingCards } from './UpcomingCards'
import { CalendarSettingsModal } from './CalendarSettingsModal'
import { useCalendarPreferences } from './useCalendarPreferences'
import { MAX_WINDOW_ITEMS, useCalendarItems } from './useCalendarItems'
import { useAvailableHeight } from './useAvailableHeight'
import { useCalendarTasks } from './useCalendarTasks'
import { isTaskItem } from './types'
import type {
  CalendarFiltersValue,
  CalendarInteractionItem,
  CalendarItem,
  CalendarRangePreset,
  CalendarReschedule,
  CalendarTab,
  CalendarTaskItem,
  CalendarView,
  UpcomingCard,
} from './types'



const CalendarEventEditor = dynamic(
  () => import('./CalendarEventEditor').then((mod) => mod.CalendarEventEditor),
  { ssr: false },
)

const SEARCH_DEBOUNCE_MS = 200
const PHONE_BREAKPOINT_PX = 640
const HIGHLIGHT_CLEAR_MS = 3000
const DEFAULT_AGENDA_HORIZON_DAYS = 7
const UPCOMING_CARDS_COUNT = 4
/** Never shrink the grid below a readable working stretch. */
const MIN_GRID_HEIGHT_PX = 320
const EMPTY_FILTERS: CalendarFiltersValue = { types: [], status: null, ownerUserId: null }

type EditorState = { open: boolean; mode: 'create' | 'edit'; item: CalendarInteractionItem | null }

const MANAGE_FEATURE = 'customers.interactions.manage'
/** Editing a task is the tasks module's permission, never the CRM's. */
const TASK_EDIT_FEATURE = 'tasks.edit'

/**
 * Which of the calendar's two domains the caller may write to.
 *
 * The grid holds records from two modules with two different features, so it
 * asks about both and gates each affordance on its own answer. This only hides
 * controls — every write is still authorised server-side by the route that
 * performs it, so a drag the UI failed to hide is refused by the API rather
 * than silently applied.
 */
function useCalendarWriteAccess(): { canManage: boolean; canEditTasks: boolean } {
  const [access, setAccess] = React.useState({ canManage: false, canEditTasks: false })
  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    apiCall<{ granted?: unknown[] }>('/api/auth/feature-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ features: [MANAGE_FEATURE, TASK_EDIT_FEATURE] }),
    })
      .then((call) => {
        if (cancelled || !call.ok) return
        const granted = Array.isArray(call.result?.granted)
          ? call.result.granted.map((feature) => String(feature))
          : []
        const holds = (feature: string) =>
          granted.some((grantedFeature) => matchFeature(feature, grantedFeature))
        setAccess({ canManage: holds(MANAGE_FEATURE), canEditTasks: holds(TASK_EDIT_FEATURE) })
      })
      .catch(() => {
        if (!cancelled && !controller.signal.aborted) setAccess({ canManage: false, canEditTasks: false })
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])
  return access
}

function asEditableItem(item: CalendarInteractionItem): CalendarInteractionItem {
  return item.isRecurringOccurrence ? { ...item, id: item.raw.id } : item
}

export type CalendarScreenProps = {
  /** True when the optional resources module is loaded (server-resolved). */
  resourcesEnabled?: boolean
  /** True when the optional staff module is loaded (server-resolved). */
  staffEnabled?: boolean
  /** True when the tasks module is loaded (server-resolved). Off means the
   *  calendar shows CRM interactions only and never calls the task API. */
  tasksEnabled?: boolean
}

export function CalendarScreen({
  resourcesEnabled = false,
  staffEnabled = true,
  tasksEnabled = false,
}: CalendarScreenProps = {}) {
  const t = useT()
  const [view, setView] = React.useState<CalendarView>('week')
  const [anchor, setAnchor] = React.useState<Date>(() => new Date())
  const [agendaHorizonDays, setAgendaHorizonDays] = React.useState(DEFAULT_AGENDA_HORIZON_DAYS)
  const [preset, setPreset] = React.useState<CalendarRangePreset | null>('thisWeek')

  React.useEffect(() => {
    if (window.innerWidth >= PHONE_BREAKPOINT_PX) return
    setView('day')
    setPreset(null)
  }, [])
  const [tab, setTab] = React.useState<CalendarTab>('all')
  const [searchText, setSearchText] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [filters, setFilters] = React.useState<CalendarFiltersValue>(EMPTY_FILTERS)
  const [editor, setEditor] = React.useState<EditorState>({ open: false, mode: 'create', item: null })
  const [editorMounted, setEditorMounted] = React.useState(false)
  const [createRange, setCreateRange] = React.useState<{ start: Date; end: Date } | null>(null)
  const gridRef = React.useRef<HTMLDivElement | null>(null)
  const gridHeight = useAvailableHeight(gridRef, MIN_GRID_HEIGHT_PX)
  const [openTask, setOpenTask] = React.useState<{
    id: string | null
    projectId: string | null
    dueDate?: string | null
    dueTime?: string | null
  } | null>(null)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [highlightItemId, setHighlightItemId] = React.useState<string | null>(null)
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false)
  const { preferences, setPreferences, hydrated: preferencesHydrated, userId: currentUserId } = useCalendarPreferences()

  const range = React.useMemo(
    () => getVisibleRange(view, anchor, agendaHorizonDays),
    [view, anchor, agendaHorizonDays],
  )
  const {
    items,
    isLoading,
    isRefreshing,
    error,
    truncated,
    typeLabels,
    typeColors,
    typeIcons,
    refetch,
    applyOverride,
    clearOverride,
    commitOverride,
  } = useCalendarItems(range)

  React.useEffect(() => {
    if (!isLoading) setHasLoadedOnce(true)
  }, [isLoading])

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchText), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchText])

  React.useEffect(() => {
    if (!highlightItemId) return
    const timer = window.setTimeout(() => setHighlightItemId(null), HIGHLIGHT_CLEAR_MS)
    return () => window.clearTimeout(timer)
  }, [highlightItemId])

  const {
    items: taskItems,
    isLoading: tasksLoading,
    truncated: tasksTruncated,
    refetch: refetchTasks,
    applyOverride: applyTaskOverride,
    clearOverride: clearTaskOverride,
  } = useCalendarTasks(range, tasksEnabled)

  // One list from two owners. Neither side is copied into the other: each entry
  // still knows which domain it came from, which is what routes every later
  // edit back to the right service.
  const allItems = React.useMemo<CalendarItem[]>(
    () => (taskItems.length > 0 ? [...items, ...taskItems] : items),
    [items, taskItems],
  )

  const visibleItems = React.useMemo(
    () => allItems.filter((item) => item.end > range.from && item.start < range.to),
    [allItems, range],
  )

  const searchedItems = React.useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase()
    if (!query) return visibleItems
    return visibleItems.filter((item) => {
      if (item.title.toLowerCase().includes(query)) return true
      if (item.location && item.location.toLowerCase().includes(query)) return true
      if (isTaskItem(item)) {
        if ((item.task.projectName ?? '').toLowerCase().includes(query)) return true
      } else {
        const rawBody = (item.raw as { body?: unknown }).body
        if (typeof rawBody === 'string' && rawBody.toLowerCase().includes(query)) return true
      }
      return item.participants.some((participant) =>
        (participant.name ?? '').toLowerCase().includes(query),
      )
    })
  }, [visibleItems, debouncedSearch])

  const baseItems = React.useMemo(
    () =>
      searchedItems.filter((item) => {
        if (filters.types.length > 0 && !filters.types.includes(item.interactionType)) return false
        if (filters.status && item.status !== filters.status) return false
        if (filters.ownerUserId && item.ownerUserId !== filters.ownerUserId) return false
        if (!preferences.showCrmActivities && item.category !== 'meeting' && item.category !== 'event') return false
        return true
      }),
    [searchedItems, filters, preferences.showCrmActivities],
  )

  const tabCounts = React.useMemo(() => countByCategory(baseItems), [baseItems])

  const viewItems = React.useMemo(() => {
    if (tab === 'meetings') return baseItems.filter((item) => item.category === 'meeting')
    if (tab === 'events') return baseItems.filter((item) => item.category === 'event')
    return baseItems
  }, [baseItems, tab])

  const conflictMap = React.useMemo(
    () => findConflicts(baseItems, { scope: preferences.conflictScope, currentUserId }),
    [baseItems, preferences.conflictScope, currentUserId],
  )
  const conflictIds = React.useMemo(() => new Set(conflictMap.keys()), [conflictMap])

  const upcomingCards = React.useMemo<UpcomingCard[]>(() => {
    const now = new Date()
    const nowMs = now.getTime()
    return baseItems
      .filter((item) => item.start.getTime() >= nowMs)
      .sort((first, second) => first.start.getTime() - second.start.getTime())
      .slice(0, UPCOMING_CARDS_COUNT)
      .map((item) => {
        const conflictCount = preferences.conflictWarnings ? (conflictMap.get(item.id)?.length ?? 0) : 0
        const kind: UpcomingCard['kind'] =
          item.status === 'canceled'
            ? 'cancelled'
            : conflictCount > 0
              ? 'conflicted'
              : isSameDay(item.start, now)
                ? 'today'
                : 'future'
        return { item, kind, conflictCount }
      })
  }, [baseItems, conflictMap, preferences.conflictWarnings])

  const typeOptions = React.useMemo(() => {
    const values = new Set<string>(Object.keys(typeLabels))
    for (const item of visibleItems) values.add(item.interactionType)
    return [...values]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: typeLabels[value] ?? value }))
  }, [visibleItems, typeLabels])

  const ownerOptions = React.useMemo(() => {
    const participantNames = new Map<string, string>()
    for (const item of visibleItems) {
      for (const participant of item.participants) {
        if (participant.name && !participantNames.has(participant.userId)) {
          participantNames.set(participant.userId, participant.name)
        }
      }
    }
    const owners = new Map<string, string>()
    for (const item of visibleItems) {
      if (!item.ownerUserId || owners.has(item.ownerUserId)) continue
      owners.set(item.ownerUserId, participantNames.get(item.ownerUserId) ?? item.ownerUserId)
    }
    return [...owners.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((first, second) => first.label.localeCompare(second.label))
  }, [visibleItems])

  const { canManage, canEditTasks } = useCalendarWriteAccess()
  /** Either domain writable — enough to arm the grid's drag affordances. */
  const canDrag = canManage || canEditTasks

  // Task writes run through the same guarded-mutation machinery as CRM writes,
  // so a blocked save, a retry and a 409 all behave identically across the two
  // domains the grid holds.
  const { runMutation: runTaskMutation, retryLastMutation: retryTaskMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'customers-calendar-task',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  /**
   * Write to one task through the Task Manager's own endpoint.
   *
   * The route re-validates the body, enforces `tasks.edit` and the tenant scope,
   * runs the task command and emits the `clientBroadcast` task event that makes
   * every other open surface — the board, the lists, this grid — refresh. The
   * optimistic-lock header is the same one the rest of the product sends, so a
   * concurrent edit is refused here exactly as it is there.
   */
  const writeTask = React.useCallback(
    async (taskId: string, body: Record<string, unknown>, updatedAt: string | null, path = '') =>
      runTaskMutation({
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), () =>
            apiCallOrThrow(`/api/tasks/tasks/${encodeURIComponent(taskId)}${path}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
          ),
        mutationPayload: { operation: 'calendarTaskWrite', taskId, ...body },
        context: {
          formId: 'customers-calendar-task',
          resourceKind: 'tasks.task',
          resourceId: taskId,
          retryLastMutation: retryTaskMutation,
        },
      }),
    [retryTaskMutation, runTaskMutation],
  )

  const openCreateEditor = React.useCallback(() => {
    if (!canManage) return
    setCreateRange(null)
    setEditorMounted(true)
    setEditor({ open: true, mode: 'create', item: null })
  }, [canManage])

  /**
   * Open an entry in its own module's editor.
   *
   * A task opens the Task Manager's `TaskPanel` — the same panel the board and
   * the lists use, with the same fields, validation, status control, assignment
   * and permissions. Building a calendar-flavoured task form would have been a
   * second place for task rules to live and drift.
   */
  const openEditEditor = React.useCallback(
    (item: CalendarItem) => {
      if (isTaskItem(item)) {
        setOpenTask({ id: item.task.id, projectId: item.task.projectId })
        return
      }
      if (!canManage) return
      setCreateRange(null)
      setEditorMounted(true)
      setEditor({ open: true, mode: 'edit', item: asEditableItem(item) })
    },
    [canManage],
  )

  /**
   * Create a task from the calendar.
   *
   * Same spot, same panel, same create command as editing one — the calendar
   * only supplies the slot the user picked. Leaving the project unset lets the
   * Task Manager put it where it puts any unfiled work.
   */
  const openCreateTask = React.useCallback(
    (seed?: { start: Date; allDay: boolean }) => {
      if (!tasksEnabled || !canEditTasks) return
      const start = seed?.start ?? anchor
      setOpenTask({
        id: null,
        projectId: null,
        dueDate: formatCalendarDate(start),
        dueTime: seed && !seed.allDay ? formatWallClockTime(start) : null,
      })
    },
    [anchor, canEditTasks, tasksEnabled],
  )

  const handleCreateRange = React.useCallback(
    (start: Date, end: Date) => {
      if (!canManage) return
      setCreateRange({ start, end })
      setEditorMounted(true)
      setEditor({ open: true, mode: 'create', item: null })
    },
    [canManage],
  )

  const seedActivityTypes = React.useMemo(() => {
    const seen = new Set<string>()
    const labels: string[] = []
    for (const value of Object.keys(typeLabels)) {
      const label = typeLabels[value] ?? value
      if (seen.has(label)) continue
      seen.add(label)
      labels.push(label)
    }
    return labels
  }, [typeLabels])

  const handleToday = React.useCallback(() => {
    setAnchor(new Date())
    setPreset(null)
  }, [])

  const handlePresetChange = React.useCallback((next: CalendarRangePreset) => {
    setPreset(next)
    setAnchor(new Date())
    if (next === 'thisWeek') {
      setView('week')
    } else if (next === 'thisMonth') {
      setView('month')
    } else {
      setView('agenda')
      setAgendaHorizonDays(next === 'next30' ? 30 : DEFAULT_AGENDA_HORIZON_DAYS)
    }
  }, [])

  const handleAnchorChange = React.useCallback((date: Date) => {
    setAnchor(date)
    setPreset(null)
  }, [])

  const handleViewChange = React.useCallback((next: CalendarView) => {
    setView(next)
    setPreset(null)
  }, [])

  const handlePrevious = React.useCallback(() => {
    setAnchor((current) => shiftAnchor(view, current, -1))
    setPreset(null)
  }, [view])

  const handleNext = React.useCallback(() => {
    setAnchor((current) => shiftAnchor(view, current, 1))
    setPreset(null)
  }, [view])

  const handleDayOpen = React.useCallback((date: Date) => {
    setView('day')
    setAnchor(date)
    setPreset(null)
  }, [])

  const handleSeeConflict = React.useCallback((item: CalendarItem) => {
    setView('week')
    setAnchor(item.start)
    setPreset(null)
    setHighlightItemId(item.id)
  }, [])

  const handleJoin = React.useCallback((item: CalendarItem) => {
    const url = resolveJoinUrl(item.location)
    if (url) window.open(url, '_blank', 'noopener')
  }, [])

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'customers-calendar-cancel',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const handleCancelItem = React.useCallback(
    async (item: CalendarItem) => {
      // A task is completed through the Task Manager's own command, so the
      // board, the lists and the calendar all reach the same state.
      if (isTaskItem(item)) {
        if (!canEditTasks) return
        try {
          // The Task Manager's own complete endpoint, so a recurring task
          // advances to its next due date rather than being marked done — the
          // behaviour the domain defines, not one the calendar invents.
          //
          // `tz` is not optional in practice: the server falls back to UTC, and
          // completion resolves `completedAt` and a recurring task's next due
          // date against it, so omitting it records the wrong day for anyone
          // completing a task near midnight outside UTC.
          await writeTask(
            item.task.id,
            { tz: calendarTimeZone() },
            item.task.updatedAt ?? null,
            '/complete',
          )
          flash(t('customers.calendar.cards.taskCompleted', 'Task completed'), 'success')
          refetchTasks()
        } catch (err) {
          if (extractOptimisticLockConflict(err)) return
          flash(t('customers.calendar.cards.taskCompleteError', 'Failed to complete task'), 'error')
        }
        return
      }
      const interactionId = item.raw.id
      try {
        await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(item.updatedAt), () =>
              apiCallOrThrow('/api/customers/interactions', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: interactionId, status: 'canceled' }),
              }),
            ),
          mutationPayload: {
            operation: 'cancelCalendarEvent',
            interactionId,
            interactionType: item.interactionType,
          },
          context: {
            formId: 'customers-calendar-cancel',
            resourceKind: 'customers.interaction',
            resourceId: interactionId,
            retryLastMutation,
          },
        })
        flash(t('customers.calendar.cards.cancelSuccess', 'Event cancelled'), 'success')
        refetch()
      } catch (err) {
        // An optimistic-lock 409 is surfaced as the persistent conflict bar by
        // useGuardedMutation (surfaceRecordConflict) — don't re-flash.
        if (extractOptimisticLockConflict(err)) return
        flash(t('customers.calendar.cards.cancelError', 'Failed to cancel event'), 'error')
      }
    },
    [canEditTasks, refetch, refetchTasks, retryLastMutation, runMutation, t, writeTask],
  )

  const { runMutation: runReschedule, retryLastMutation: retryReschedule } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'customers-calendar-reschedule',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  /**
   * Persist a task drag through the Task Manager.
   *
   * The patch carries only what a task can express — a due date and an optional
   * wall-clock time — and goes through the module's own update mutation, so the
   * permission check, the validator and the optimistic-lock header are the ones
   * the board and the lists already use. That mutation invalidates every task
   * surface on success, which is what keeps the board and the calendar showing
   * the same thing; on failure nothing was written and React Query restores the
   * previous value, so the card returns to where the server still has it.
   */
  const rescheduleTask = React.useCallback(
    async (item: CalendarTaskItem, start: Date, allDay: boolean) => {
      const change = taskScheduleChangeFor(start, allDay)
      if (change.dueDate === (item.task.dueDate ?? null) && change.dueTime === (item.task.dueTime ?? null)) return
      // Show the drop at once; the write follows. A rejection puts the card back
      // where the server still has it rather than leaving it where it never went.
      applyTaskOverride(item.task.id, { calendarDate: change.dueDate, calendarTime: change.dueTime })
      try {
        await writeTask(item.task.id, change, item.task.updatedAt ?? null)
        refetchTasks()
      } catch (err) {
        clearTaskOverride(item.task.id)
        if (extractOptimisticLockConflict(err)) {
          // The persistent conflict bar already explains this; resync so the
          // user sees whatever the other editor saved.
          refetchTasks()
          return
        }
        flash(
          t('customers.calendar.errors.taskRescheduleFailed', 'Could not move this task. It has been restored.'),
          'error',
        )
      }
    },
    [applyTaskOverride, clearTaskOverride, refetchTasks, t, writeTask],
  )

  /**
   * Drag/resize persistence. The move is shown immediately, the write happens
   * in the background, and a failure restores the previous position rather than
   * leaving a card where the server never put it.
   */
  const handleReschedule = React.useCallback(
    async ({ item, start, end, allDay }: CalendarReschedule) => {
      if (isTaskItem(item)) {
        if (!canEditTasks) return
        await rescheduleTask(item, start, allDay)
        return
      }
      if (!canManage) return
      if (item.isRecurringOccurrence) {
        // The occurrence's id points at the series master, so persisting a drag
        // here would move every occurrence. Editing a single one needs the
        // this/following/series scope prompt that is not built yet.
        flash(
          t(
            'customers.calendar.errors.recurringDragUnsupported',
            'Open the event to change a repeating series.',
          ),
          'error',
        )
        return
      }
      if (!(start instanceof Date) || Number.isNaN(start.getTime())) return
      if (!(end instanceof Date) || Number.isNaN(end.getTime())) return
      if (end.getTime() <= start.getTime()) {
        flash(t('customers.calendar.errors.invalidRange', 'End time must be after the start time'), 'error')
        return
      }

      const interactionId = item.raw.id
      const previous = {
        scheduledAt: item.raw.scheduledAt ?? null,
        durationMinutes: item.raw.durationMinutes ?? null,
        allDay: item.raw.allDay ?? null,
        updatedAt: item.updatedAt,
      }
      const durationMinutes = allDay ? null : Math.round((end.getTime() - start.getTime()) / 60_000)
      const nextPayload = {
        scheduledAt: start.toISOString(),
        durationMinutes,
        allDay,
      }

      applyOverride(interactionId, { ...nextPayload, updatedAt: item.updatedAt })

      try {
        const response = await runReschedule({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(item.updatedAt), () =>
              apiCallOrThrow<{ item?: { updatedAt?: string | null } }>('/api/customers/interactions', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: interactionId, ...nextPayload }),
              }),
            ),
          mutationPayload: {
            operation: 'rescheduleCalendarEvent',
            interactionId,
            interactionType: item.interactionType,
          },
          context: {
            formId: 'customers-calendar-reschedule',
            resourceKind: 'customers.interaction',
            resourceId: interactionId,
            retryLastMutation: retryReschedule,
          },
        })
        const confirmedUpdatedAt =
          response && typeof response === 'object' && 'item' in response
            ? ((response as { item?: { updatedAt?: string | null } }).item?.updatedAt ?? null)
            : null
        // Fold the confirmed values in instead of refetching the window, so the
        // card never flashes back to its old position.
        commitOverride(interactionId, {
          ...nextPayload,
          updatedAt: confirmedUpdatedAt ?? new Date().toISOString(),
        })
      } catch (err) {
        applyOverride(interactionId, previous)
        clearOverride(interactionId)
        if (extractOptimisticLockConflict(err)) {
          // The persistent conflict bar already explains this; resync the window
          // so the user sees whatever the other editor saved.
          refetch()
          return
        }
        flash(t('customers.calendar.errors.rescheduleFailed', 'Could not move this event. It has been restored.'), 'error')
      }
    },
    [
      applyOverride,
      canEditTasks,
      canManage,
      clearOverride,
      commitOverride,
      refetch,
      rescheduleTask,
      retryReschedule,
      runReschedule,
      t,
    ],
  )

  const handleCreateAt = React.useCallback(
    (date: Date) => {
      if (!canManage) return
      const start = new Date(date)
      start.setHours(9, 0, 0, 0)
      const end = new Date(start.getTime() + 30 * 60_000)
      handleCreateRange(start, end)
    },
    [canManage, handleCreateRange],
  )

  const focusSearch = React.useCallback(() => {
    const node = document.querySelector('[data-calendar-search]')
    if (node instanceof HTMLInputElement) node.focus()
    else if (node instanceof HTMLElement) node.querySelector('input')?.focus()
  }, [])

  const editorOpen = editor.open
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
      }
      if (editorOpen) return
      switch (event.key) {
        case 't':
        case 'T':
          event.preventDefault()
          setAnchor(new Date())
          setPreset(null)
          break
        case 'd':
        case 'D':
          event.preventDefault()
          setView('day')
          setPreset(null)
          break
        case 'w':
        case 'W':
          event.preventDefault()
          setView('week')
          setPreset(null)
          break
        case 'm':
        case 'M':
          event.preventDefault()
          setView('month')
          setPreset(null)
          break
        case 'a':
        case 'A':
          event.preventDefault()
          setView('agenda')
          setPreset(null)
          break
        case 'n':
        case 'N':
          event.preventDefault()
          openCreateEditor()
          break
        case '/':
          event.preventDefault()
          focusSearch()
          break
        case '?':
          // The legend lives in Settings now, so `?` opens the one modal that
          // carries it rather than a second dialog listing the same keys.
          event.preventDefault()
          setSettingsOpen((open) => !open)
          break
        case 'Escape':
          setHighlightItemId(null)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editorOpen, focusSearch, openCreateEditor])

  const showInitialLoading = ((isLoading || tasksLoading) && !hasLoadedOnce) || !preferencesHydrated

  const showRefreshing = isRefreshing && hasLoadedOnce
  const anyTruncated = truncated || tasksTruncated
  const calendarStatus = anyTruncated || showRefreshing ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {anyTruncated ? (
        <p className="text-xs text-muted-foreground" role="status">
          {t('customers.calendar.notice.truncated', 'Showing first {count} items for this range.', {
            count: MAX_WINDOW_ITEMS,
          })}
        </p>
      ) : null}
      {showRefreshing ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <span aria-hidden className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
          {t('customers.calendar.notice.refreshing', 'Refreshing…')}
        </p>
      ) : null}
    </div>
  ) : null

  let viewArea: React.ReactNode
  if (error) {
    viewArea = (
      <ErrorMessage
        label={t('customers.calendar.errors.loadFailed', 'Failed to load calendar events.')}
        action={
          <Button type="button" variant="outline" size="sm" onClick={refetch}>
            {t('customers.calendar.errors.retry', 'Retry')}
          </Button>
        }
      />
    )
  } else if (showInitialLoading) {
    viewArea = <CalendarSkeleton view={view} columns={view === 'day' ? 1 : 7} />
  } else if (view === 'month') {
    viewArea = (
      <MonthGrid
        anchor={anchor}
        items={viewItems}
        canManage={canDrag}
        aiSummaries={preferences.aiSummaries}
        onItemClick={openEditEditor}
        onJoin={handleJoin}
        onDayOpen={handleDayOpen}
        onCreateAt={canManage ? handleCreateAt : undefined}
      />
    )
  } else if (view === 'agenda') {
    viewArea = (
      <AgendaList
        anchor={anchor}
        horizonDays={agendaHorizonDays}
        items={viewItems}
        typeLabels={typeLabels}
        onItemClick={openEditEditor}
      />
    )
  } else {
    viewArea = (
      <TimeGrid
        days={view === 'day' ? 1 : 7}
        anchor={anchor}
        items={viewItems}
        conflictIds={conflictIds}
        showWeekends={preferences.showWeekends}
        showConflicts={preferences.conflictWarnings}
        aiSummaries={preferences.aiSummaries}
        canManage={canDrag}
        highlightItemId={highlightItemId}
        onItemClick={openEditEditor}
        onJoin={handleJoin}
        onCreateRange={canManage ? handleCreateRange : undefined}
        onReschedule={canDrag ? handleReschedule : undefined}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
      <CalendarHeader
        view={view}
        anchor={anchor}
        range={range}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onToday={handleToday}
        onViewChange={handleViewChange}
        onNewEvent={canManage ? openCreateEditor : undefined}
        onNewTask={tasksEnabled && canEditTasks ? () => openCreateTask() : undefined}
        onOpenShortcuts={() => setSettingsOpen(true)}
      />
      <CalendarScopeBar
        tab={tab}
        counts={tabCounts}
        range={range}
        anchor={anchor}
        preset={preset}
        status={calendarStatus}
        trailing={
          <CalendarToolbar
            anchor={anchor}
            search={searchText}
            filters={filters}
            typeOptions={typeOptions}
            ownerOptions={ownerOptions}
            onAnchorChange={handleAnchorChange}
            onSearchChange={setSearchText}
            onFiltersChange={setFilters}
          />
        }
        onTabChange={setTab}
        onPresetChange={handlePresetChange}
        onAnchorChange={handleAnchorChange}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {/* The next-up strip belongs with the agenda, which is the view that
          exists to answer "what is coming". Day, week and month answer it with
          the grid itself, and give the grid the height instead. */}
      {view === 'agenda' ? (
        <UpcomingCards
          cards={upcomingCards}
          canManage={canManage}
          onJoin={handleJoin}
          onSeeConflict={handleSeeConflict}
          onOpen={openEditEditor}
          onEdit={openEditEditor}
          onCancel={handleCancelItem}
        />
      ) : null}
      {/* The grid takes whatever the window has left. Measured rather than
          inherited: the backend shell's `<main>` never passes a definite height
          down, so a `h-full` grid would grow to all 24 hours and push the page
          into a scroll instead of scrolling itself. */}
      <div
        ref={gridRef}
        className="flex min-h-80 flex-1 flex-col overflow-hidden"
        style={gridHeight === null ? undefined : { height: gridHeight, maxHeight: gridHeight }}
      >
        {viewArea}
      </div>
      {/* The task editor is contributed by the tasks module through this spot,
          not imported: the calendar never owns a second task form, and when the
          module is disabled the spot is simply empty. */}
      {openTask ? (
        <InjectionSpot
          spotId="calendar:task-editor"
          context={{
            ...openTask,
            onClose: () => {
              setOpenTask(null)
              refetchTasks()
            },
          }}
        />
      ) : null}
      <CalendarSettingsModal
        open={settingsOpen}
        preferences={preferences}
        seedActivityTypes={seedActivityTypes}
        onOpenChange={setSettingsOpen}
        onSave={(next) => {
          setPreferences(next)
          flash(t('customers.calendar.settings.saved', 'Calendar settings saved'), 'success')
        }}
      />
      {editorMounted ? (
        <CalendarEventEditor
          open={editor.open}
          mode={editor.mode}
          item={editor.item}
          defaultDate={anchor}
          defaultRange={createRange}
          typeLabels={typeLabels}
          typeIcons={typeIcons}
          conflictScope={preferences.conflictScope}
          currentUserId={currentUserId}
          resourcesEnabled={resourcesEnabled}
          staffEnabled={staffEnabled}
          onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
          onSaved={refetch}
        />
      ) : null}
    </div>
  )
}
