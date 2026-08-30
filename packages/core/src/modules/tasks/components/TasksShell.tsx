"use client"

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CalendarRange } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CalendarPanel } from './CalendarPanel'
import { ProjectFormDialog } from './ProjectFormDialog'
import { QuickAddDialog } from './QuickAddDialog'
import { TasksSidebar } from './TasksSidebar'
import { useTasksLiveRefresh } from './hooks'
import { CALENDAR_PARAM, PROJECT_FORM_PARAM, QUICK_ADD_PARAM } from './shellParams'

export { CALENDAR_PARAM, PROJECT_FORM_PARAM, QUICK_ADD_PARAM } from './shellParams'

/**
 * Read/write helpers for the shell's URL state. Quick Add, the project form and
 * the calendar all live in the query string so they survive a refresh and can
 * be linked to — the same contract PCA ERP used.
 */
export function useTasksShellControls() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const setParam = React.useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams.toString())
      if (value === null) next.delete(key)
      else next.set(key, value)
      const serialized = next.toString()
      router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  return React.useMemo(
    () => ({
      openQuickAdd: () => setParam(QUICK_ADD_PARAM, '1'),
      closeQuickAdd: () => setParam(QUICK_ADD_PARAM, null),
      openProjectForm: (projectId: string | 'new') => setParam(PROJECT_FORM_PARAM, projectId),
      closeProjectForm: () => setParam(PROJECT_FORM_PARAM, null),
      openCalendar: () => setParam(CALENDAR_PARAM, '1'),
      closeCalendar: () => setParam(CALENDAR_PARAM, null),
      setParam,
    }),
    [setParam],
  )
}

/**
 * The module shell: local navigation on the left, the page on the right, and
 * the three overlays every tasks surface can raise.
 */
export function TasksShell({ children }: { children: React.ReactNode }) {
  const t = useT()
  const searchParams = useSearchParams()
  const controls = useTasksShellControls()
  useTasksLiveRefresh()

  const quickAddOpen = searchParams.get(QUICK_ADD_PARAM) === '1'
  const projectForm = searchParams.get(PROJECT_FORM_PARAM)
  const calendarOpen = searchParams.get(CALENDAR_PARAM) === '1'

  return (
    <>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-4 text-foreground md:grid-cols-[14rem_minmax(0,1fr)] md:grid-rows-1 md:gap-6">
        <TasksSidebar
          onQuickAdd={controls.openQuickAdd}
          onNewProject={() => controls.openProjectForm('new')}
        />
        <div className="flex min-h-0 min-w-0 flex-col">{children}</div>
      </div>

      {quickAddOpen && <QuickAddDialog onClose={controls.closeQuickAdd} />}
      {projectForm && (
        <ProjectFormDialog
          key={projectForm}
          projectId={projectForm === 'new' ? null : projectForm}
          onClose={controls.closeProjectForm}
        />
      )}
      {calendarOpen && <CalendarPanel onClose={controls.closeCalendar} />}
    </>
  )
}

/** The calendar trigger, rendered in a page's header actions. */
export function TasksCalendarButton() {
  const t = useT()
  const controls = useTasksShellControls()
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      onClick={controls.openCalendar}
      aria-label={t('tasks.calendar.open', 'Open calendar')}
      title={t('tasks.calendar.title', 'Calendar')}
    >
      <CalendarRange className="size-4" aria-hidden="true" />
    </Button>
  )
}
