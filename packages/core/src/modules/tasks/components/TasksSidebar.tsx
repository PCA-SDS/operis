"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CalendarDays,
  CheckCircle2,
  CirclePlus,
  LayoutList,
  Plus,
  Sun,
  UserCheck,
  Users,
} from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { useMyTasks, useProjects } from './hooks'

const NAV_ITEM =
  'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:shadow-focus'

/**
 * The module's own navigation, sitting inside the page next to the app shell's
 * global sidebar. It carries what the global nav cannot: live counts, the
 * project list, and the two creation affordances people reach for constantly.
 */
export function TasksSidebar({
  onQuickAdd,
  onNewProject,
}: {
  onQuickAdd: () => void
  onNewProject: () => void
}) {
  const t = useT()
  const pathname = usePathname()
  const { projects, isInitialLoading } = useProjects({
    archived: 'active',
    pageSize: 25,
    sort: 'name',
    order: 'asc',
  })
  const today = useMyTasks('today')
  const todayCount = today.data?.total ?? 0

  const views = [
    { href: '/backend/tasks/all', icon: LayoutList, label: t('tasks.sidebar.allTasks', 'All Tasks') },
    { href: '/backend/tasks/today', icon: Sun, label: t('tasks.sidebar.today', 'Today'), count: todayCount },
    { href: '/backend/tasks/upcoming', icon: CalendarDays, label: t('tasks.sidebar.upcoming', 'Upcoming') },
    { href: '/backend/tasks/assigned', icon: UserCheck, label: t('tasks.sidebar.assigned', 'Assigned to Me') },
    { href: '/backend/tasks/completed', icon: CheckCircle2, label: t('tasks.sidebar.completed', 'Completed') },
    { href: '/backend/tasks/team', icon: Users, label: t('tasks.sidebar.team', 'Team') },
  ]

  return (
    <aside aria-label={t('tasks.sidebar.navLabel', 'Tasks navigation')}>
      <nav className="flex items-center gap-1 overflow-x-auto rounded-xl bg-surface-muted p-2 md:sticky md:top-0 md:flex-col md:items-stretch md:gap-1 md:overflow-visible">
        <p className="hidden px-3 pb-1 pt-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground md:block">
          {t('tasks.nav.group', 'Tasks')}
        </p>

        <button
          type="button"
          onClick={onQuickAdd}
          className={cn(NAV_ITEM, 'font-semibold text-primary hover:bg-primary-soft')}
        >
          <CirclePlus className="size-5 shrink-0" aria-hidden="true" />
          {t('tasks.sidebar.addTask', 'Add Task')}
        </button>

        {views.map((view) => {
          const active = pathname === view.href
          const Icon = view.icon
          return (
            <Link
              key={view.href}
              href={view.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                NAV_ITEM,
                active
                  ? 'bg-primary-soft text-primary'
                  : 'text-muted-foreground hover:bg-surface-strong hover:text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">{view.label}</span>
              {view.count ? (
                <span className="text-xs tabular-nums opacity-70">{view.count}</span>
              ) : null}
            </Link>
          )
        })}

        <hr aria-hidden="true" className="hidden border-t border-border md:my-2 md:block" />

        <div className="flex shrink-0 items-center gap-1">
          <Link
            href="/backend/tasks/projects"
            className="flex-1 whitespace-nowrap rounded-md px-3 py-1 text-overline font-semibold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('tasks.sidebar.myProjects', 'My Projects')}
          </Link>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={onNewProject}
            aria-label={t('tasks.sidebar.newProject', 'New project')}
          >
            <Plus className="size-4" aria-hidden="true" />
          </IconButton>
        </div>

        {isInitialLoading ? (
          <div className="flex shrink-0 gap-1 md:block md:space-y-1 md:px-1">
            <Skeleton className="h-7 w-24 rounded-md md:w-auto" />
            <Skeleton className="h-7 w-24 rounded-md md:w-auto" />
          </div>
        ) : projects.length === 0 ? (
          <div className="shrink-0 px-2">
            <EmptyState
              variant="subtle"
              size="sm"
              title={t('tasks.sidebar.noProjects', 'No projects yet')}
              description={t('tasks.sidebar.noProjectsHint', 'Use the + above to create your first one.')}
            />
          </div>
        ) : (
          <div className="flex shrink-0 gap-1 md:block md:max-h-[50vh] md:space-y-1 md:overflow-y-auto">
            {projects.map((project) => {
              const href = `/backend/tasks/projects/${project.id}`
              const active = pathname === href
              return (
                <Link
                  key={project.id}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:shadow-focus',
                    active
                      ? 'bg-primary-soft font-medium text-primary'
                      : 'text-muted-foreground hover:bg-surface-strong hover:text-foreground',
                  )}
                >
                  <span aria-hidden="true" className="shrink-0 text-sm leading-none">
                    {project.icon}
                  </span>
                  <span className="flex-1 truncate">{project.name}</span>
                  {project.openTaskCount > 0 && (
                    <span className="text-xs tabular-nums opacity-70">{project.openTaskCount}</span>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </nav>
    </aside>
  )
}
