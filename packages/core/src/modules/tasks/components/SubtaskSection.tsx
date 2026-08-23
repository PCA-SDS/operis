"use client"

import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TaskDetailDto, TaskStatus } from '../data/types'
import { SubtaskProgress } from './badges'
import { QuickAddComposer } from './QuickAddComposer'
import { TaskListRow } from './TaskListRow'
import { AddTaskRow, CARD_CAPTION_CLASS } from './ui-bits'
import { useTaskMutations } from './hooks'

/**
 * A task's direct children. Composed with the same Quick Add the rest of the
 * module uses, so "@amir tomorrow" works when breaking work down too.
 */
export function SubtaskSection({
  task,
  projectId,
  composing,
  onComposingChange,
  onOpenTask,
}: {
  task: TaskDetailDto
  projectId: string
  composing: boolean
  onComposingChange: (open: boolean) => void
  onOpenTask: (id: string) => void
}) {
  const t = useT()
  const { update } = useTaskMutations(projectId)

  const changeStatus = (id: string, status: TaskStatus, updatedAt: string) =>
    update.mutate(
      { id, body: { status }, updatedAt },
      { onError: () => flash(t('tasks.list.updateFailed', 'Could not update.'), 'error') },
    )

  return (
    <section aria-label={t('tasks.panel.subtasks', 'Subtasks')} className="space-y-2.5 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className={CARD_CAPTION_CLASS}>{t('tasks.panel.subtasks', 'Subtasks')}</h3>
        <SubtaskProgress done={task.subtaskDoneCount} total={task.subtaskCount} />
      </div>

      <div className="-mx-3 sm:-mx-5">
        {task.subtasks.length > 0 ? (
          <ul className="divide-y divide-border">
            {task.subtasks.map((subtask) => (
              <TaskListRow
                key={subtask.id}
                task={subtask}
                onOpen={() => onOpenTask(subtask.id)}
                onStatusChange={(status) => changeStatus(subtask.id, status, subtask.updatedAt)}
              />
            ))}
          </ul>
        ) : (
          <div className="px-3 sm:px-5">
            <EmptyState
              variant="subtle"
              size="sm"
              title={t('tasks.panel.noSubtasks', 'No subtasks yet')}
              description={t(
                'tasks.panel.noSubtasksHint',
                'Break this task into smaller steps you can tick off one by one.',
              )}
            />
          </div>
        )}

        {!composing && (
          <AddTaskRow
            label={t('tasks.common.addSubtask', 'Add subtask')}
            onClick={() => onComposingChange(true)}
          />
        )}
      </div>

      {composing && (
        <QuickAddComposer
          parentTask={{
            id: task.id,
            projectId: task.projectId,
            projectKey: task.projectKey,
            number: task.number,
          }}
          onClose={() => onComposingChange(false)}
        />
      )}
    </section>
  )
}
