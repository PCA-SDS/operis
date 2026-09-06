"use client"

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Calendar, CheckCircle2, CornerDownRight, MessageSquare, Minus, Repeat2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Pagination } from '@open-mercato/ui/primitives/pagination'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { MyTaskView, TaskListItemDto, TaskStatus } from '../data/types'
import { QuickAddComposer } from './QuickAddComposer'
import { StatusSelect } from './StatusSelect'
import { SubtaskProgress } from './badges'
import { PriorityBars } from './PriorityBars'
import { TaskPanel } from './TaskPanel'
import { AddTaskRow, ErrorState, SkeletonBlock } from './ui-bits'
import {
  TASK_STATUS_META,
  describeRecurrence,
  formatDayHeading,
  formatDueChip,
  formatTaskTime,
  formatTaskTimeOfDay,
  isOverdue,
  localDayOf,
  localTodayIso,
  taskRef,
} from './format'
import { FLASH_ROW_CLASS, useNewTaskFlash } from './useNewTaskFlash'
import { useMyTasks, useTaskError, useTaskMutations } from './hooks'

const VIEW_KEYS: Record<MyTaskView, { title: string; empty: string; emptyHint: string; noun: string }> = {
  all: {
    title: 'tasks.views.all.title',
    empty: 'tasks.views.all.empty',
    emptyHint: 'tasks.views.all.emptyHint',
    noun: 'task',
  },
  today: {
    title: 'tasks.views.today.title',
    empty: 'tasks.views.today.empty',
    emptyHint: 'tasks.views.today.emptyHint',
    noun: 'task',
  },
  upcoming: {
    title: 'tasks.views.upcoming.title',
    empty: 'tasks.views.upcoming.empty',
    emptyHint: 'tasks.views.upcoming.emptyHint',
    noun: 'task',
  },
  assigned: {
    title: 'tasks.views.assigned.title',
    empty: 'tasks.views.assigned.empty',
    emptyHint: 'tasks.views.assigned.emptyHint',
    noun: 'task',
  },
  completed: {
    title: 'tasks.views.completed.title',
    empty: 'tasks.views.completed.empty',
    emptyHint: 'tasks.views.completed.emptyHint',
    noun: 'completedTask',
  },
}

const VIEW_FALLBACKS: Record<MyTaskView, { title: string; empty: string; emptyHint: string }> = {
  all: {
    title: 'All Tasks',
    empty: 'No open tasks',
    emptyHint: 'Every task across your projects is done. Add one below.',
  },
  today: {
    title: 'Today',
    empty: 'Nothing due today',
    emptyHint: 'Tasks with a due date of today (or earlier) show up here.',
  },
  upcoming: {
    title: 'Upcoming',
    empty: 'Nothing scheduled',
    emptyHint: "Give tasks a due date and they'll queue up here.",
  },
  assigned: {
    title: 'Assigned to me',
    empty: 'Nothing assigned to you',
    emptyHint: 'Tasks assigned to you across all projects show up here.',
  },
  completed: {
    title: 'Completed',
    empty: 'Nothing completed yet',
    emptyHint: 'Finished tasks land here, most recent first.',
  },
}

/**
 * A cross-project personal view. All five routes share this component; they
 * differ only in which predicate the server applies and how the results are
 * grouped, which is what makes them feel like one product rather than five
 * screens.
 */
export function MyTasksView({ view }: { view: MyTaskView }) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const keys = VIEW_KEYS[view]
  const fallbacks = VIEW_FALLBACKS[view]
  const title = t(keys.title, fallbacks.title)
  const isCompletedLog = view === 'completed'

  const urlQuery = searchParams.get('q') ?? ''
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const { flashTaskId, flashRef } = useNewTaskFlash()

  const [searchInput, setSearchInput] = React.useState(urlQuery)
  const [composerOpen, setComposerOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<{ id: string; projectId: string } | null>(null)

  React.useEffect(() => setSearchInput(urlQuery), [urlQuery])

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
      }
      const serialized = next.toString()
      router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  // Searching resets paging: page 4 of the old result set is meaningless
  // against a new one.
  React.useEffect(() => {
    if (searchInput === urlQuery) return
    const timer = window.setTimeout(() => setParams({ q: searchInput || null, page: null }), 300)
    return () => window.clearTimeout(timer)
  }, [searchInput, urlQuery, setParams])

  const { data, isLoading, error, retry } = useMyTasks(view, { page, search: urlQuery })
  const errorMessage = useTaskError(error, t('tasks.common.loadFailed', "This didn't load"))
  const actions = useTaskMutations()

  const groups = React.useMemo(() => groupTasks(t, view, data?.items ?? []), [t, view, data?.items])

  const countLabel = data
    ? t(`tasks.views.count.${keys.noun}${data.total === 1 ? '' : '_plural'}`, `{count} tasks`, {
        count: data.total,
      })
    : ''

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          {data && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {countLabel}
            </p>
          )}
        </div>
        <div className="w-56">
          <SearchInput
            value={searchInput}
            onChange={setSearchInput}
            placeholder={t('tasks.views.searchPlaceholder', 'Search tasks…')}
            aria-label={t('tasks.views.searchLabel', 'Search tasks')}
          />
        </div>
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
        {errorMessage ? (
          <ErrorState message={errorMessage} onRetry={retry} size="lg" />
        ) : isLoading ? (
          <div className="min-h-72 space-y-1.5">
            {[0, 1, 2, 3].map((index) => (
              <SkeletonBlock key={index} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : (data?.items.length ?? 0) === 0 && !composerOpen ? (
          urlQuery ? (
            <EmptyState
              size="lg"
              variant="subtle"
              title={t('tasks.views.searchEmpty', 'No tasks match your search')}
              description={t(
                'tasks.views.searchEmptyHint',
                'Nothing in {view} matches “{query}”. Try a shorter word or clear the search.',
                { view: title, query: urlQuery },
              )}
              actions={
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearchInput('')
                    setParams({ q: null, page: null })
                  }}
                >
                  {t('tasks.views.clearSearch', 'Clear search')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              size="lg"
              variant="subtle"
              title={t(keys.empty, fallbacks.empty)}
              description={t(keys.emptyHint, fallbacks.emptyHint)}
            />
          )
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.label ?? 'all'}>
                {group.label && (
                  <h2
                    className={cn(
                      'border-b border-border pb-1.5 text-sm font-semibold',
                      group.danger ? 'text-status-error-text' : 'text-foreground',
                    )}
                  >
                    {group.label}
                  </h2>
                )}
                <ul>
                  {group.tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      actions={actions}
                      showDateChip={group.showDateChips}
                      isFlashing={task.id === flashTaskId}
                      flashRef={task.id === flashTaskId ? flashRef : null}
                      onOpen={() => setSelected({ id: task.id, projectId: task.projectId })}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {/* Completed is a log of what happened; adding to it would be nonsense. */}
        {!errorMessage && !isLoading && !isCompletedLog && (
          <div className="mt-2">
            {composerOpen ? (
              <QuickAddComposer onClose={() => setComposerOpen(false)} />
            ) : (
              <AddTaskRow
                variant="accent"
                label={t('tasks.common.addTask', 'Add task')}
                onClick={() => setComposerOpen(true)}
              />
            )}
          </div>
        )}
      </div>

      {data && data.totalPages > 1 && (
        <div className="mt-4 shrink-0">
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={(next) => setParams({ page: String(next) })}
          />
        </div>
      )}

      {selected && (
        <TaskPanel
          taskId={selected.id}
          projectId={selected.projectId}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function TaskRow({
  task,
  actions,
  showDateChip,
  isFlashing,
  flashRef,
  onOpen,
}: {
  task: TaskListItemDto
  actions: ReturnType<typeof useTaskMutations>
  showDateChip: boolean
  isFlashing: boolean
  flashRef: ((node: HTMLElement | null) => void) | null
  onOpen: () => void
}) {
  const t = useT()
  const { complete, update } = actions
  const isDone = task.status === 'done' || task.status === 'cancelled'
  const overdue = isOverdue(task.dueDate)

  const onStatusChange = (next: TaskStatus) => {
    if (next === task.status) return
    const reference = taskRef(task.projectKey, task.number)

    // Completing goes through the dedicated endpoint rather than a status
    // write, because a recurring task must roll forward instead of finishing.
    if (next === 'done') {
      complete.mutate(
        { id: task.id, updatedAt: task.updatedAt },
        {
          onSuccess: (fresh) =>
            flash(
              fresh.recurrence
                ? t('tasks.toast.rescheduled', '{ref} rescheduled to {date}.', {
                    ref: reference,
                    date: fresh.dueDate ? formatDueChip(t, fresh.dueDate) : '',
                  })
                : t('tasks.toast.completed', '{ref} completed.', { ref: reference }),
              'success',
            ),
          onError: () => flash(t('tasks.toast.completeFailed', 'Could not complete the task.'), 'error'),
        },
      )
      return
    }

    update.mutate(
      { id: task.id, body: { status: next }, updatedAt: task.updatedAt },
      {
        onSuccess: () =>
          flash(
            t('tasks.toast.statusChanged', '{ref} moved to {status}.', {
              ref: reference,
              status: t(TASK_STATUS_META[next].labelKey, TASK_STATUS_META[next].fallback),
            }),
            'success',
          ),
        onError: () => flash(t('tasks.toast.statusFailed', 'Could not update the status.'), 'error'),
      },
    )
  }

  const statusPending =
    (complete.isPending && complete.variables?.id === task.id) ||
    (update.isPending && update.variables?.id === task.id)

  const completedTime = formatTaskTimeOfDay(task.completedAt) || null

  const hasMeta = isDone
    ? completedTime !== null || task.commentCount > 0 || task.subtaskCount > 0 || task.parent !== null
    : (showDateChip && !!task.dueDate) ||
      !!task.recurrence ||
      task.commentCount > 0 ||
      task.subtaskCount > 0 ||
      task.parent !== null ||
      (!!task.dueTime && !showDateChip)

  return (
    <li
      ref={flashRef ?? undefined}
      className={cn(
        'flex items-start gap-3 border-b border-border px-1 py-2.5 transition-colors duration-700',
        isFlashing && FLASH_ROW_CLASS,
      )}
    >
      <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
        {task.priority !== 'none' ? (
          <PriorityBars priority={task.priority} className="size-3.5" />
        ) : (
          <Minus
            className="size-3.5 shrink-0 text-disabled-foreground"
            aria-label={t('tasks.common.noPriority', 'No priority')}
          />
        )}
        <StatusSelect
          value={task.status}
          onChange={onStatusChange}
          variant="icon"
          disabled={statusPending}
        />
      </div>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            'block w-full truncate text-left text-sm focus:outline-none focus-visible:shadow-focus',
            isDone ? 'text-muted-foreground line-through' : 'text-foreground',
          )}
        >
          {task.title}
        </button>

        {hasMeta && (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
            {isDone && completedTime && <span>{completedTime}</span>}

            {task.parent && (
              <span
                className="inline-flex min-w-0 items-center gap-1"
                title={t('tasks.common.subtaskOf', 'Subtask of {ref} {title}', {
                  ref: taskRef(task.projectKey, task.parent.number),
                  title: task.parent.title,
                })}
              >
                <CornerDownRight className="size-3" aria-hidden="true" />
                <span className="max-w-40 truncate">{task.parent.title}</span>
              </span>
            )}

            <SubtaskProgress done={task.subtaskDoneCount} total={task.subtaskCount} />

            {!isDone && showDateChip && task.dueDate && (
              <span
                className={cn(
                  'inline-flex items-center gap-1',
                  overdue && 'font-medium text-status-error-text',
                )}
              >
                <Calendar className="size-3" aria-hidden="true" />
                {formatDueChip(t, task.dueDate)}
                {task.dueTime ? ` ${formatTaskTime(task.dueTime)}` : ''}
              </span>
            )}

            {!isDone && !showDateChip && task.dueTime && <span>{formatTaskTime(task.dueTime)}</span>}

            {!isDone && task.recurrence && (
              <span className="inline-flex items-center gap-1">
                <Repeat2 className="size-3" aria-hidden="true" />
                {describeRecurrence(t, task.recurrence)}
              </span>
            )}

            {task.commentCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="size-3" aria-hidden="true" />
                {task.commentCount}
              </span>
            )}
          </p>
        )}
      </div>

      <span className="mt-0.5 hidden max-w-48 shrink-0 items-center gap-1 truncate text-xs text-muted-foreground sm:flex">
        <span className="truncate">
          {task.projectIcon} {task.projectName}
        </span>
      </span>
    </li>
  )
}

type TaskGroup = {
  label: string | null
  danger?: boolean
  /** Rows in a dated group already know their date from the heading, so the
   *  per-row chip would just repeat it. */
  showDateChips: boolean
  tasks: TaskListItemDto[]
}

function groupTasks(t: TranslateFn, view: MyTaskView, tasks: TaskListItemDto[]): TaskGroup[] {
  if (tasks.length === 0) return []

  if (view === 'today') {
    const today = localTodayIso()
    const overdue = tasks.filter((task) => (task.dueDate ?? today) < today)
    const dueToday = tasks.filter((task) => (task.dueDate ?? today) >= today)
    const groups: TaskGroup[] = []
    if (overdue.length > 0) {
      groups.push({
        label: t('tasks.views.overdue', 'Overdue'),
        danger: true,
        showDateChips: true,
        tasks: overdue,
      })
    }
    if (dueToday.length > 0) {
      groups.push({ label: formatDayHeading(t, today), showDateChips: false, tasks: dueToday })
    }
    return groups
  }

  if (view === 'upcoming') return groupByDay(t, tasks, (task) => task.dueDate ?? '', true)
  if (view === 'completed') return groupByDay(t, tasks, (task) => localDayOf(task.completedAt), false)

  return [{ label: null, showDateChips: true, tasks }]
}

function groupByDay(
  t: TranslateFn,
  tasks: TaskListItemDto[],
  dayOf: (task: TaskListItemDto) => string,
  dangerWhenPast: boolean,
): TaskGroup[] {
  const byDate = new Map<string, TaskListItemDto[]>()
  for (const task of tasks) {
    const key = dayOf(task)
    const bucket = byDate.get(key)
    if (bucket) bucket.push(task)
    else byDate.set(key, [task])
  }
  return [...byDate.entries()].map(([date, items]) => ({
    label: formatDayHeading(t, date),
    danger: dangerWhenPast && isOverdue(date),
    showDateChips: false,
    tasks: items,
  }))
}
