"use client"

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Pagination } from '@open-mercato/ui/primitives/pagination'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import {
  PROJECT_ARCHIVED_FILTERS,
  PROJECT_SORTABLE_FIELDS,
  type ProjectArchivedFilter,
  type ProjectSortField,
} from '../data/types'
import { useTasksShellControls } from './TasksShell'
import { ErrorState, ProgressBar, SkeletonBlock, UserAvatar } from './ui-bits'
import { useProjects, useTaskError } from './hooks'

const PAGE_SIZE = 20

/** Every project the caller can reach, with how much of each is left. */
export function ProjectsListView() {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const controls = useTasksShellControls()

  const archivedParam = searchParams.get('archived')
  const archived: ProjectArchivedFilter = PROJECT_ARCHIVED_FILTERS.includes(
    archivedParam as ProjectArchivedFilter,
  )
    ? (archivedParam as ProjectArchivedFilter)
    : 'active'
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const urlQuery = (searchParams.get('q') ?? '').slice(0, 120)
  const sortParam = searchParams.get('sort')
  const sort: ProjectSortField | null = PROJECT_SORTABLE_FIELDS.includes(sortParam as ProjectSortField)
    ? (sortParam as ProjectSortField)
    : null
  const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc'

  const [searchInput, setSearchInput] = React.useState(urlQuery)
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

  React.useEffect(() => {
    if (searchInput === urlQuery) return
    const timer = window.setTimeout(() => setParams({ q: searchInput || null, page: null }), 300)
    return () => window.clearTimeout(timer)
  }, [searchInput, urlQuery, setParams])

  const { projects, page: loadedPage, total, totalPages, pageSize, isInitialLoading, isFetching, error, retry } =
    useProjects({ archived, search: urlQuery || null, sort, order, page, pageSize: PAGE_SIZE })
  const errorMessage = useTaskError(error, t('tasks.common.loadFailed', "This didn't load"))

  const hasProjects = projects.length > 0
  const isSearching = urlQuery !== ''
  const isFiltered = archived !== 'active'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-normal text-foreground">{t('tasks.projects.title', 'Projects')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('tasks.projects.description', 'Every project you can access, with its tasks and progress.')}
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => controls.openProjectForm('new')}>
          <Plus className="size-4" aria-hidden="true" />
          {t('tasks.projects.new', 'New project')}
        </Button>
      </div>

      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          value={archived}
          onValueChange={(value) => setParams({ archived: value === 'active' ? null : value, page: null })}
          aria-label={t('tasks.projects.archivedFilterLabel', 'Filter by archived state')}
        >
          <SegmentedControlItem value="active">
            {t('tasks.projects.filter.active', 'Active')}
          </SegmentedControlItem>
          <SegmentedControlItem value="archived">
            {t('tasks.projects.filter.archived', 'Archived')}
          </SegmentedControlItem>
          <SegmentedControlItem value="all">{t('tasks.projects.filter.all', 'All')}</SegmentedControlItem>
        </SegmentedControl>

        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          placeholder={t('tasks.projects.searchPlaceholder', 'Search projects')}
          aria-label={t('tasks.projects.searchLabel', 'Search projects')}
        />
      </div>

      {errorMessage ? (
        <ErrorState message={errorMessage} onRetry={retry} size="lg" />
      ) : isInitialLoading ? (
        <SkeletonBlock className="min-h-72" />
      ) : hasProjects ? (
        <div
          aria-busy={isFetching}
          className={cn(
            'flex min-h-0 flex-1 flex-col gap-4 transition-opacity duration-150',
            isFetching ? 'opacity-70' : 'opacity-100',
          )}
        >
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => {
              const done = project.taskCount - project.openTaskCount
              const percent = project.taskCount === 0 ? 0 : Math.round((done / project.taskCount) * 100)
              return (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/backend/tasks/projects/${project.id}`)}
                    className="flex w-full flex-col gap-3 rounded-xl bg-surface p-4 text-left shadow-md transition-shadow hover:shadow-lg focus:outline-none focus-visible:shadow-focus"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-base"
                      >
                        {project.icon}
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                          {project.name}
                          <span className="font-mono text-overline font-normal text-muted-foreground">
                            {project.key}
                          </span>
                        </p>
                        {project.description && (
                          <p className="truncate text-xs text-muted-foreground">{project.description}</p>
                        )}
                      </div>
                    </div>

                    <span className="flex min-w-0 items-center gap-2">
                      <UserAvatar name={project.owner?.name ?? null} size="xs" />
                      <span className="truncate text-sm text-muted-foreground">
                        {project.owner?.name ?? t('tasks.common.unassigned', 'Unassigned')}
                      </span>
                    </span>

                    <div className="space-y-1">
                      <ProgressBar value={percent} />
                      <span className="text-xs text-muted-foreground">
                        {t('tasks.projects.progressSummary', '{open} open · {total} total', {
                          open: project.openTaskCount,
                          total: project.taskCount,
                        })}
                      </span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>

          {totalPages > 1 && (
            <div className="shrink-0">
              <Pagination
                page={loadedPage}
                pageSize={pageSize}
                total={total}
                disabled={isFetching}
                onPageChange={(next) => setParams({ page: String(next) })}
              />
            </div>
          )}
        </div>
      ) : isSearching ? (
        <EmptyState
          size="lg"
          variant="subtle"
          title={t('tasks.projects.emptySearch', 'No projects match your search')}
          description={t(
            'tasks.projects.emptySearchHint',
            'Nothing matches “{query}”. Try a shorter word or clear the search.',
            { query: urlQuery },
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
      ) : isFiltered ? (
        <EmptyState
          size="lg"
          variant="subtle"
          title={t('tasks.projects.emptyFiltered', 'No projects in this view')}
          description={t('tasks.projects.emptyFilteredHint', 'Switch back to Active, or pick All, to see the rest.')}
          actions={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setParams({ archived: null, page: null })}
            >
              {t('tasks.projects.showActive', 'Show active projects')}
            </Button>
          }
        />
      ) : (
        <EmptyState
          size="lg"
          variant="subtle"
          title={t('tasks.projects.empty', 'No projects yet')}
          description={t(
            'tasks.projects.emptyHint',
            'A project groups tasks, milestones and docs for one piece of work.',
          )}
          actions={
            <Button type="button" size="sm" onClick={() => controls.openProjectForm('new')}>
              <Plus className="size-4" aria-hidden="true" />
              {t('tasks.projects.new', 'New project')}
            </Button>
          }
        />
      )}
    </div>
  )
}
