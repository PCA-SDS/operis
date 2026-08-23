"use client"

import * as React from 'react'
import { ChevronRight, Plus, SlidersHorizontal } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { TASK_PRIORITIES, type TaskListItemDto, type TaskPriority, type TaskStatus } from '../data/types'
import { StatusHeadline } from './badges'
import { TaskListRow } from './TaskListRow'
import { AddTaskRow, CARD_CLASS, CARD_HEADER_CLASS, ErrorState, SkeletonBlock } from './ui-bits'
import { TASK_GROUP_ORDER, TASK_PRIORITY_META } from './format'
import { useAssignableUsers, useBoard, useTaskError, useTaskMutations } from './hooks'
import { useNewTaskFlash } from './useNewTaskFlash'

type Scope = 'all' | 'active' | 'backlog'

/** "Active" is work someone has actually picked up or is blocked on — the
 *  backlog is deliberately excluded so this scope answers "what's in flight". */
const SCOPE_STATUSES: Record<Scope, ReadonlySet<TaskStatus>> = {
  all: new Set(TASK_GROUP_ORDER),
  active: new Set<TaskStatus>(['in_progress', 'review', 'blocked', 'pending']),
  backlog: new Set<TaskStatus>(['backlog']),
}

const ANY = '__any__'
const UNASSIGNED = '__unassigned__'

/**
 * The grouped task list: every status a section, collapsible, filtered in the
 * browser. The board is already loaded for this project, so filtering here is
 * instant rather than a round trip per keystroke.
 */
export function TasksListTab({
  projectId,
  onOpenTask,
  onCreateTask,
  selectedTaskId,
}: {
  projectId: string
  onOpenTask: (id: string) => void
  onCreateTask: (status: TaskStatus) => void
  selectedTaskId: string | null
}) {
  const t = useT()
  const { tasks, isLoading, error, retry } = useBoard(projectId)
  const errorMessage = useTaskError(error, t('tasks.common.loadFailed', "This didn't load"))
  const { users } = useAssignableUsers()
  const { update } = useTaskMutations(projectId)
  const { flashTaskId, flashRef } = useNewTaskFlash()

  const [scope, setScope] = React.useState<Scope>('all')
  const [showFilters, setShowFilters] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [priority, setPriority] = React.useState<TaskPriority | typeof ANY>(ANY)
  const [assigneeId, setAssigneeId] = React.useState<string>(ANY)
  const [collapsed, setCollapsed] = React.useState<Set<TaskStatus>>(new Set())

  const groups = React.useMemo(() => {
    const needle = search.trim().toLowerCase()
    const allowed = SCOPE_STATUSES[scope]
    const byStatus = new Map<TaskStatus, TaskListItemDto[]>()
    for (const status of TASK_GROUP_ORDER) byStatus.set(status, [])

    for (const task of [...tasks].sort((a, b) => a.rank - b.rank)) {
      if (!allowed.has(task.status)) continue
      if (priority !== ANY && task.priority !== priority) continue
      if (assigneeId === UNASSIGNED && task.assignees.length > 0) continue
      if (
        assigneeId !== ANY &&
        assigneeId !== UNASSIGNED &&
        !task.assignees.some((person) => person.id === assigneeId)
      ) {
        continue
      }
      if (needle && !task.title.toLowerCase().includes(needle)) continue
      byStatus.get(task.status)?.push(task)
    }
    return byStatus
  }, [tasks, scope, priority, assigneeId, search])

  const total = React.useMemo(
    () => [...groups.values()].reduce((sum, rows) => sum + rows.length, 0),
    [groups],
  )

  const toggle = (status: TaskStatus) =>
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })

  const changeStatus = (id: string, status: TaskStatus, updatedAt: string) =>
    update.mutate(
      { id, body: { status }, updatedAt },
      { onError: () => flash(t('tasks.list.updateFailed', 'Could not update.'), 'error') },
    )

  if (errorMessage) return <ErrorState message={errorMessage} onRetry={retry} size="lg" />
  if (isLoading) return <SkeletonBlock className="h-96" />

  const searchTerm = search.trim()
  const isFiltered = scope !== 'all' || priority !== ANY || assigneeId !== ANY
  const visibleStatuses = TASK_GROUP_ORDER.filter(
    (status) => SCOPE_STATUSES[scope].has(status) && (groups.get(status) ?? []).length > 0,
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <SegmentedControl
          value={scope}
          onValueChange={(value) => setScope(value as Scope)}
          aria-label={t('tasks.list.scopeLabel', 'Task scope')}
        >
          <SegmentedControlItem value="all">{t('tasks.list.scope.all', 'All')}</SegmentedControlItem>
          <SegmentedControlItem value="active">
            {t('tasks.list.scope.active', 'Active')}
          </SegmentedControlItem>
          <SegmentedControlItem value="backlog">
            {t('tasks.list.scope.backlog', 'Backlog')}
          </SegmentedControlItem>
        </SegmentedControl>

        <Button
          type="button"
          variant={showFilters ? 'secondary' : 'ghost'}
          size="default"
          aria-pressed={showFilters}
          onClick={() => setShowFilters((value) => !value)}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          {t('tasks.list.filter', 'Filter')}
        </Button>

        <Button type="button" size="default" className="ml-auto" onClick={() => onCreateTask('backlog')}>
          <Plus className="size-4" aria-hidden="true" />
          {t('tasks.list.newTask', 'New task')}
        </Button>
      </div>

      {showFilters && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('tasks.views.searchPlaceholder', 'Search tasks…')}
            aria-label={t('tasks.views.searchLabel', 'Search tasks')}
            className="w-44 sm:w-56"
          />
          <div className="w-40">
            <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority | typeof ANY)}>
              <SelectTrigger aria-label={t('tasks.priority.placeholder', 'Priority')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('tasks.priority.any', 'Any priority')}</SelectItem>
                {TASK_PRIORITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(TASK_PRIORITY_META[value].labelKey, TASK_PRIORITY_META[value].fallback)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-44">
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger aria-label={t('tasks.list.assigneePlaceholder', 'Assignee')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('tasks.list.assigneeAnyone', 'Anyone')}</SelectItem>
                <SelectItem value={UNASSIGNED}>
                  {t('tasks.list.assigneeUnassigned', 'Unassigned')}
                </SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {total === 0 && searchTerm !== '' ? (
        <EmptyState
          size="lg"
          variant="subtle"
          title={t('tasks.list.emptySearch', 'No tasks match your search')}
          description={t(
            'tasks.list.emptySearchHint',
            'Nothing in this project matches “{query}”. Try a shorter word or clear the search.',
            { query: searchTerm },
          )}
          actions={
            <Button type="button" variant="secondary" size="sm" onClick={() => setSearch('')}>
              {t('tasks.views.clearSearch', 'Clear search')}
            </Button>
          }
        />
      ) : total === 0 && isFiltered ? (
        <EmptyState
          size="lg"
          variant="subtle"
          title={t('tasks.list.emptyFiltered', 'No tasks in this view')}
          description={t(
            'tasks.list.emptyFilteredHint',
            'Every task in this project is hidden by the filters you picked.',
          )}
          actions={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setScope('all')
                setPriority(ANY)
                setAssigneeId(ANY)
              }}
            >
              {t('tasks.list.clearFilters', 'Clear filters')}
            </Button>
          }
        />
      ) : total === 0 ? (
        <EmptyState
          size="lg"
          variant="subtle"
          title={t('tasks.list.empty', 'No tasks yet')}
          description={t(
            'tasks.list.emptyHint',
            'Add the first task and it will show up here, grouped by status.',
          )}
          actions={
            <Button type="button" size="sm" onClick={() => onCreateTask('backlog')}>
              <Plus className="size-4" aria-hidden="true" />
              {t('tasks.list.newTask', 'New task')}
            </Button>
          }
        />
      ) : (
        <div className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1 pb-1">
          {visibleStatuses.map((status) => {
            const rows = groups.get(status) ?? []
            const isCollapsed = collapsed.has(status)
            return (
              <section key={status} className={CARD_CLASS}>
                <button
                  type="button"
                  onClick={() => toggle(status)}
                  aria-expanded={!isCollapsed}
                  className={cn(
                    CARD_HEADER_CLASS,
                    'w-full border-b-0 text-left transition-colors hover:bg-surface-strong',
                  )}
                >
                  <ChevronRight
                    className={cn(
                      'size-3.5 text-muted-foreground transition-transform duration-300',
                      !isCollapsed && 'rotate-90',
                    )}
                    aria-hidden="true"
                  />
                  <StatusHeadline status={status} count={rows.length} />
                </button>

                {/* Collapsing animates the row height rather than unmounting, so
                    the section can reopen without refetching or losing scroll. */}
                <div
                  className={cn(
                    'grid transition-[grid-template-rows] duration-300 ease-in-out',
                    isCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
                  )}
                >
                  <div
                    className={cn(
                      'min-h-0 overflow-hidden transition-all duration-300',
                      isCollapsed ? 'invisible opacity-0' : 'visible opacity-100',
                    )}
                  >
                    <ul className="divide-y divide-border border-t border-border">
                      {rows.map((task) => (
                        <TaskListRow
                          key={task.id}
                          task={task}
                          selected={task.id === selectedTaskId}
                          isFlashing={task.id === flashTaskId}
                          flashRef={task.id === flashTaskId ? flashRef : null}
                          onOpen={() => onOpenTask(task.id)}
                          onStatusChange={(next) => changeStatus(task.id, next, task.updatedAt)}
                        />
                      ))}
                      <li>
                        <AddTaskRow
                          indent
                          label={t('tasks.common.addTask', 'Add task')}
                          onClick={() => onCreateTask(status)}
                        />
                      </li>
                    </ul>
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
