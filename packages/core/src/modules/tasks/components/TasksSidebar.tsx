"use client"

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
import {
  ModuleSidebar,
  ModuleSidebarAction,
  ModuleSidebarDivider,
  ModuleSidebarLink,
  ModuleSidebarSection,
} from '@open-mercato/ui/backend/module-nav/ModuleSidebar'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useMyTasks, useProjects } from './hooks'

/**
 * The Task Manager's module sidebar. Every module gets one built from the same
 * `module-nav` parts; this one replaces the generic page list (its pages opt
 * out with `moduleSidebar: false`) because it carries what a page list cannot:
 * live counts, the project list, and the two creation affordances people reach
 * for constantly.
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
    <ModuleSidebar label={t('tasks.sidebar.navLabel', 'Tasks navigation')} title={t('tasks.nav.group', 'Tasks')}>
      <ModuleSidebarAction
        icon={<CirclePlus aria-hidden="true" />}
        label={t('tasks.sidebar.addTask', 'Add Task')}
        onClick={onQuickAdd}
      />

      {views.map((view) => {
        const Icon = view.icon
        return (
          <ModuleSidebarLink
            key={view.href}
            href={view.href}
            icon={<Icon />}
            label={view.label}
            active={pathname === view.href}
            count={view.count}
          />
        )
      })}

      <ModuleSidebarDivider />

      <ModuleSidebarSection
        label={t('tasks.sidebar.myProjects', 'My Projects')}
        href="/backend/tasks/projects"
        action={{
          icon: <Plus aria-hidden="true" />,
          label: t('tasks.sidebar.newProject', 'New project'),
          onClick: onNewProject,
        }}
        loading={isInitialLoading}
        empty={{
          title: t('tasks.sidebar.noProjects', 'No projects yet'),
          description: t('tasks.sidebar.noProjectsHint', 'Use the + above to create your first one.'),
        }}
      >
        {projects.map((project) => {
          const href = `/backend/tasks/projects/${project.id}`
          return (
            <ModuleSidebarLink
              key={project.id}
              href={href}
              icon={<span className="text-sm leading-none">{project.icon}</span>}
              label={project.name}
              active={pathname === href}
              count={project.openTaskCount > 0 ? project.openTaskCount : undefined}
            />
          )
        })}
      </ModuleSidebarSection>
    </ModuleSidebar>
  )
}
