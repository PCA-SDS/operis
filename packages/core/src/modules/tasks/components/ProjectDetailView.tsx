"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  CheckCircle2,
  ChevronLeft,
  Columns3,
  FileText,
  Info,
  LayoutList,
  Milestone as MilestoneIcon,
  Pencil,
} from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TaskStatus } from '../data/types'
import { extensionPoints } from '../extension-points'
import { CompletedTab } from './CompletedTab'
import { DocsTab } from './DocsTab'
import { KanbanBoard } from './KanbanBoard'
import { MilestonesTab } from './MilestonesTab'
import { OverviewTab } from './OverviewTab'
import { TaskPanel } from './TaskPanel'
import { TasksListTab } from './TasksListTab'
import { useTasksShellControls } from './TasksShell'
import { ErrorState, SkeletonBlock, TasksTabs, type TabDef } from './ui-bits'
import { NEW_TASK_PARAM } from './useNewTaskFlash'
import { useProject, useProjectMutations, useTaskError } from './hooks'

type Tab = 'list' | 'board' | 'completed' | 'overview' | 'milestones' | 'docs'

const TAB_VALUES = new Set<Tab>(['list', 'board', 'completed', 'overview', 'milestones', 'docs'])

/**
 * One project across its six views. The tab lives in the URL so a board or a
 * doc page can be linked to directly.
 */
export function ProjectDetailView({ projectId }: { projectId: string }) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const controls = useTasksShellControls()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const { project, isLoading, error, retry } = useProject(projectId)
  const errorMessage = useTaskError(error, t('tasks.common.loadFailed', "This didn't load"))
  const { archive, remove } = useProjectMutations()

  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null)
  const [createStatus, setCreateStatus] = React.useState<TaskStatus | null>(null)

  const rawTab = searchParams.get('tab')
  const tab: Tab = rawTab && TAB_VALUES.has(rawTab as Tab) ? (rawTab as Tab) : 'list'

  const tabs: readonly TabDef<Tab>[] = [
    { value: 'list', label: t('tasks.detail.tabs.list', 'Tasks'), icon: LayoutList },
    { value: 'board', label: t('tasks.detail.tabs.board', 'Board'), icon: Columns3 },
    { value: 'completed', label: t('tasks.detail.tabs.completed', 'Completed'), icon: CheckCircle2 },
    { value: 'overview', label: t('tasks.detail.tabs.overview', 'Overview'), icon: Info },
    { value: 'milestones', label: t('tasks.detail.tabs.milestones', 'Milestones'), icon: MilestoneIcon },
    { value: 'docs', label: t('tasks.detail.tabs.docs', 'Docs'), icon: FileText },
  ]

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  const setTab = (next: Tab) => {
    setParams({ tab: next })
    // The task panel belongs to the task views; leaving them should close it
    // rather than leave a dialog floating over an unrelated tab.
    if (next !== 'board' && next !== 'list') {
      setSelectedTaskId(null)
      setCreateStatus(null)
    }
  }

  /** After creating a task, switch to a view that shows it and flag the row. */
  const revealNewTask = (taskId: string) => {
    setParams({ tab: tab !== 'board' && tab !== 'list' ? 'list' : tab, [NEW_TASK_PARAM]: taskId })
  }

  const openTask = (id: string) => {
    setCreateStatus(null)
    setSelectedTaskId(id)
  }
  const openCreate = (status: TaskStatus) => {
    setSelectedTaskId(null)
    setCreateStatus(status)
  }

  if (errorMessage) return <ErrorState message={errorMessage} onRetry={retry} size="lg" />
  if (isLoading || !project) return <SkeletonBlock className="min-h-0 flex-1" />

  const isArchived = project.archivedAt !== null

  const confirmDelete = async () => {
    const ok = await confirm({
      title: t('tasks.projects.deleteTitle', 'Delete project?'),
      description: t(
        'tasks.projects.deleteBody',
        'This permanently deletes "{name}" and all its tasks, milestones, and docs. This can\'t be undone.',
        { name: project.name },
      ),
      confirmText: t('tasks.projects.deleteConfirm', 'Delete project'),
      variant: 'destructive',
    })
    if (!ok) return
    remove.mutate(
      { id: project.id, updatedAt: project.updatedAt },
      {
        onSuccess: () => {
          flash(t('tasks.projects.deleted', 'Project deleted.'), 'success')
          router.push('/backend/tasks/projects')
        },
        onError: () => flash(t('tasks.projects.deleteFailed', 'Could not delete the project.'), 'error'),
      },
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Link
        href="/backend/tasks/projects"
        className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {t('tasks.projects.backToProjects', 'Projects')}
      </Link>

      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-2xl"
          >
            {project.icon}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-normal text-foreground sm:text-3xl">{project.name}</h1>
            <span className="font-mono text-sm text-muted-foreground">{project.key}</span>
            {isArchived && (
              <StatusBadge variant="neutral">{t('tasks.projects.archived', 'Archived')}</StatusBadge>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => controls.openProjectForm(project.id)}>
            <Pencil className="size-4" aria-hidden="true" />
            {t('tasks.projects.edit', 'Edit')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={archive.isPending}
            onClick={() =>
              archive.mutate(
                { id: project.id, archived: !isArchived, updatedAt: project.updatedAt },
                {
                  onSuccess: () =>
                    flash(
                      isArchived
                        ? t('tasks.projects.restoredToast', 'Project restored.')
                        : t('tasks.projects.archivedToast', 'Project archived.'),
                      'success',
                    ),
                  onError: () =>
                    flash(t('tasks.projects.updateFailed', 'Could not update the project.'), 'error'),
                },
              )
            }
          >
            {isArchived ? t('tasks.projects.restore', 'Restore') : t('tasks.projects.archive', 'Archive')}
          </Button>
          <Button type="button" variant="destructive-outline" size="sm" onClick={() => void confirmDelete()}>
            {t('tasks.common.delete', 'Delete')}
          </Button>
        </div>
      </div>

      <div className="shrink-0">
        <TasksTabs
          tabs={tabs}
          value={tab}
          onChange={setTab}
          ariaLabel={t('tasks.detail.tabsLabel', 'Project views')}
        />
      </div>

      <div className="min-h-0 flex-1">
        <div className="-mx-1 flex h-full min-h-0 flex-col overflow-y-auto px-1 pb-1">
          {tab === 'overview' && <OverviewTab project={project} />}
          {tab === 'board' && (
            <KanbanBoard projectId={project.id} onOpenTask={openTask} onCreateTask={openCreate} />
          )}
          {tab === 'list' && (
            <TasksListTab
              projectId={project.id}
              onOpenTask={openTask}
              onCreateTask={openCreate}
              selectedTaskId={selectedTaskId}
            />
          )}
          {tab === 'completed' && <CompletedTab projectId={project.id} onOpenTask={openTask} />}
          {tab === 'milestones' && <MilestonesTab projectId={project.id} />}
          {tab === 'docs' && <DocsTab projectId={project.id} />}

          {/* Project-scoped surface for other modules — reports, integrations,
              anything about this project. Renders nothing when unclaimed. */}
          <InjectionSpot
            spotId={extensionPoints.hosts.projectDetailFooter.spotId}
            context={{ entityId: 'tasks:tasks_project', recordId: project.id }}
          />
        </div>
      </div>

      {selectedTaskId && (
        <TaskPanel
          key={selectedTaskId}
          taskId={selectedTaskId}
          projectId={project.id}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
      {createStatus && (
        <TaskPanel
          key={`create-${createStatus}`}
          taskId={null}
          projectId={project.id}
          defaultStatus={createStatus}
          onCreated={revealNewTask}
          onClose={() => setCreateStatus(null)}
        />
      )}

      {ConfirmDialogElement}
    </div>
  )
}
