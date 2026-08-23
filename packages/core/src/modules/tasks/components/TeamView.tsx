"use client"

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LayoutGrid, List } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Pagination } from '@open-mercato/ui/primitives/pagination'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { TaskListItemDto, TaskStatus, TeamMemberDto } from '../data/types'
import { StatusHeadline } from './badges'
import { TaskCard } from './TaskCard'
import { TaskListRow } from './TaskListRow'
import { TaskPanel } from './TaskPanel'
import {
  CARD_CAPTION_CLASS,
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CountBadge,
  ErrorState,
  SkeletonBlock,
  TasksTabs,
  UserAvatar,
  type TabDef,
} from './ui-bits'
import { TASK_GROUP_ORDER } from './format'
import { useTaskError, useTeamMemberBoard, useTeamMemberTasks, useTeamMembers } from './hooks'

type View = 'board' | 'list'

/** Whose work is where. The member list is the caller's organization; picking
 *  someone shows their plate without leaving the page. */
export function TeamView() {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const selectedId = searchParams.get('member')
  const view: View = searchParams.get('view') === 'list' ? 'list' : 'board'
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)

  const { members, isLoading, error, retry } = useTeamMembers()
  const errorMessage = useTaskError(error, t('tasks.common.loadFailed', "This didn't load"))
  const [selectedTask, setSelectedTask] = React.useState<{ id: string; projectId: string } | null>(null)

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    const serialized = next.toString()
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false })
  }

  const effectiveId = selectedId ?? members[0]?.id ?? null
  const selected = members.find((member) => member.id === effectiveId) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="shrink-0">
        <h1 className="text-2xl font-normal text-foreground">{t('tasks.team.title', 'Team')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('tasks.team.description', 'See tasks for everyone in your organization.')}
        </p>
      </div>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1 pb-1 lg:overflow-visible lg:pb-0">
        {errorMessage ? (
          <ErrorState message={errorMessage} onRetry={retry} size="lg" />
        ) : isLoading ? (
          <SkeletonBlock className="min-h-0 flex-1" />
        ) : members.length === 0 ? (
          <EmptyState
            size="lg"
            variant="subtle"
            title={t('tasks.team.empty', 'No teammates yet')}
            description={t(
              'tasks.team.emptyHint',
              'Once your organisation structure is set up, the people you can view will appear here.',
            )}
          />
        ) : (
          <div className="grid gap-4 lg:h-full lg:min-h-0 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <MembersPanel
              members={members}
              selectedId={effectiveId}
              onSelect={(id) => setParams({ member: id, page: null })}
            />

            <section className="flex min-w-0 flex-col lg:min-h-0">
              {selected ? (
                <MemberTasks
                  key={selected.id}
                  member={selected}
                  view={view}
                  page={page}
                  onView={(next) => setParams({ view: next, page: null })}
                  onPage={(next) => setParams({ page: String(next) })}
                  onOpenTask={(task) => setSelectedTask({ id: task.id, projectId: task.projectId })}
                />
              ) : (
                <EmptyState
                  size="lg"
                  variant="subtle"
                  title={t('tasks.team.pick', 'Pick a teammate')}
                  description={t(
                    'tasks.team.pickHint',
                    'Select a name on the left to see the tasks they have to do.',
                  )}
                />
              )}
            </section>
          </div>
        )}
      </div>

      {selectedTask && (
        <TaskPanel
          taskId={selectedTask.id}
          projectId={selectedTask.projectId}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  )
}

function MembersPanel({
  members,
  selectedId,
  onSelect,
}: {
  members: TeamMemberDto[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const t = useT()
  return (
    <div className={cn(CARD_CLASS, 'flex flex-col lg:min-h-0')}>
      <div className={cn(CARD_HEADER_CLASS, 'shrink-0')}>
        <span className={CARD_CAPTION_CLASS}>{t('tasks.team.peopleYouCanView', 'People you can view')}</span>
        <CountBadge value={members.length} />
      </div>
      <ul className="max-h-96 divide-y divide-border overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1">
        {members.map((member) => {
          const active = member.id === selectedId
          return (
            <li key={member.id}>
              <button
                type="button"
                onClick={() => onSelect(member.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:shadow-focus sm:px-5',
                  active ? 'bg-table-selected' : 'hover:bg-surface-muted',
                )}
              >
                <UserAvatar name={member.name} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">{member.name}</span>
                    {member.isSelf && (
                      <span className="rounded bg-surface-strong px-1 text-overline text-muted-foreground">
                        {t('tasks.team.you', 'You')}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {member.roleNames.length > 0
                      ? member.roleNames.join(', ')
                      : t('tasks.team.noRole', 'No role')}
                  </span>
                </span>
                {member.openTaskCount > 0 && (
                  <span className="shrink-0 rounded-full bg-surface-strong px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {member.openTaskCount}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function MemberTasks({
  member,
  view,
  page,
  onView,
  onPage,
  onOpenTask,
}: {
  member: TeamMemberDto
  view: View
  page: number
  onView: (next: View) => void
  onPage: (page: number) => void
  onOpenTask: (task: TaskListItemDto) => void
}) {
  const t = useT()
  const tabs: readonly TabDef<View>[] = [
    { value: 'board', label: t('tasks.team.tabs.board', 'Board'), icon: LayoutGrid },
    { value: 'list', label: t('tasks.team.tabs.list', 'Table'), icon: List },
  ]

  return (
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      <h2 className="shrink-0 text-lg font-semibold text-foreground">
        {member.isSelf
          ? t('tasks.team.yourTasks', 'Your tasks')
          : t('tasks.team.membersTasks', "{name}'s tasks", { name: member.name })}
      </h2>

      <div className="shrink-0">
        <TasksTabs
          tabs={tabs}
          value={view}
          onChange={onView}
          ariaLabel={t('tasks.team.tabsLabel', 'Task views')}
        />
      </div>

      <div className="flex flex-col lg:min-h-0 lg:flex-1">
        {view === 'board' ? (
          <MemberBoard userId={member.id} onOpenTask={onOpenTask} />
        ) : (
          <MemberList userId={member.id} page={page} onPage={onPage} onOpenTask={onOpenTask} />
        )}
      </div>
    </div>
  )
}

function MemberBoard({
  userId,
  onOpenTask,
}: {
  userId: string
  onOpenTask: (task: TaskListItemDto) => void
}) {
  const t = useT()
  const { data, isLoading, error, retry } = useTeamMemberBoard(userId)
  const errorMessage = useTaskError(error, t('tasks.common.loadFailed', "This didn't load"))
  const tasks = data?.tasks ?? []

  if (errorMessage) return <ErrorState message={errorMessage} onRetry={retry} size="lg" />
  if (isLoading) return <SkeletonBlock className="h-80 lg:min-h-0 lg:flex-1" />
  if (tasks.length === 0) {
    return (
      <EmptyState
        size="lg"
        variant="subtle"
        title={t('tasks.team.noTasks', 'No tasks assigned')}
        description={t('tasks.team.noTasksHint', 'This person has nothing on their plate right now.')}
      />
    )
  }

  // Empty columns are dropped here: this board is read-only, so a column with
  // nothing in it is dead width rather than a drop target.
  const columns = TASK_GROUP_ORDER.map((status: TaskStatus) => ({
    status,
    tasks: tasks.filter((task) => task.status === status),
  })).filter((column) => column.tasks.length > 0)

  return (
    <div className="flex gap-3 overflow-x-auto pb-1 lg:min-h-0 lg:flex-1">
      {columns.map((column) => (
        <div
          key={column.status}
          className={cn(CARD_CLASS, 'flex max-h-128 w-70 shrink-0 flex-col lg:h-full lg:max-h-none lg:min-h-0')}
        >
          <div className={cn(CARD_HEADER_CLASS, 'shrink-0 sm:px-3')}>
            <StatusHeadline status={column.status} count={column.tasks.length} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 py-2">
            {column.tasks.map((task) => (
              <TaskCard key={task.id} task={task} onOpen={() => onOpenTask(task)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function MemberList({
  userId,
  page,
  onPage,
  onOpenTask,
}: {
  userId: string
  page: number
  onPage: (page: number) => void
  onOpenTask: (task: TaskListItemDto) => void
}) {
  const t = useT()
  const { data, isLoading, isFetching, error, retry } = useTeamMemberTasks(userId, { page })
  const errorMessage = useTaskError(error, t('tasks.common.loadFailed', "This didn't load"))

  if (errorMessage) return <ErrorState message={errorMessage} onRetry={retry} size="lg" />
  if (isLoading) return <SkeletonBlock className="h-80 lg:min-h-0 lg:flex-1" />

  const items = data?.items ?? []
  if (items.length === 0) {
    return (
      <EmptyState
        size="lg"
        variant="subtle"
        title={t('tasks.team.noTasks', 'No tasks assigned')}
        description={t('tasks.team.noTasksHint', 'This person has nothing on their plate right now.')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1">
      <div className={cn(CARD_CLASS, 'flex flex-col lg:min-h-0 lg:flex-1')}>
        <ul className="divide-y divide-border lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {items.map((task) => (
            <TaskListRow key={task.id} task={task} onOpen={() => onOpenTask(task)} />
          ))}
        </ul>
      </div>

      {(data?.totalPages ?? 1) > 1 && (
        <div className="shrink-0">
          <Pagination
            page={data?.page ?? page}
            pageSize={data?.pageSize ?? items.length}
            total={data?.total ?? items.length}
            disabled={isFetching}
            onPageChange={onPage}
          />
        </div>
      )}
    </div>
  )
}
