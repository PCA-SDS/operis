"use client"

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { MilestoneDto, MilestoneStatus } from '../data/types'
import { MilestoneStatusPicker } from './pickers'
import {
  CARD_CAPTION_CLASS,
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CountBadge,
  DateInput,
  ErrorState,
  Field,
  ProgressBar,
  SkeletonBlock,
  TextInput,
} from './ui-bits'
import { formatTaskDate } from './format'
import { useMilestoneMutations, useMilestones, useTaskError } from './hooks'

/** Dated goals inside a project. Progress is derived from the tasks pointing at
 *  each one, so a milestone can never drift out of sync with its work. */
export function MilestonesTab({ projectId }: { projectId: string }) {
  const t = useT()
  const { milestones, isLoading, error, retry } = useMilestones(projectId)
  const errorMessage = useTaskError(error, t('tasks.common.loadFailed', "This didn't load"))
  const { create, update, remove } = useMilestoneMutations(projectId)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [adding, setAdding] = React.useState(false)
  const [name, setName] = React.useState('')
  const [dueDate, setDueDate] = React.useState('')
  const [status, setStatus] = React.useState<MilestoneStatus>('planned')

  const submit = async () => {
    const trimmed = name.trim()
    if (trimmed === '') return
    try {
      await create.mutateAsync({ name: trimmed, status, dueDate: dueDate || null })
      setName('')
      setDueDate('')
      setStatus('planned')
      setAdding(false)
      flash(t('tasks.milestones.added', 'Milestone added.'), 'success')
    } catch {
      flash(t('tasks.milestones.addFailed', 'Could not add the milestone.'), 'error')
    }
  }

  const confirmDelete = async (milestone: MilestoneDto) => {
    const ok = await confirm({
      title: t('tasks.milestones.deleteTitle', 'Delete milestone?'),
      description: t('tasks.milestones.deleteBody', 'Tasks in "{name}" stay, but lose their milestone.', {
        name: milestone.name,
      }),
      confirmText: t('tasks.common.delete', 'Delete'),
      variant: 'destructive',
    })
    if (!ok) return
    remove.mutate(
      { id: milestone.id, updatedAt: milestone.updatedAt },
      {
        onSuccess: () => flash(t('tasks.milestones.deleted', 'Milestone deleted.'), 'success'),
        onError: () => flash(t('tasks.milestones.deleteFailed', 'Could not delete milestone.'), 'error'),
      },
    )
  }

  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t('tasks.milestones.title', 'Milestones')}</h3>
        {!adding && (
          <Button type="button" variant="secondary" size="default" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t('tasks.milestones.new', 'New milestone')}
          </Button>
        )}
      </div>

      {adding && (
        <div className={`${CARD_CLASS} space-y-3 p-4`}>
          <Field label={t('tasks.milestones.name', 'Name')} required>
            <TextInput
              value={name}
              onChange={setName}
              placeholder={t('tasks.milestones.namePlaceholder', 'v1.0 launch')}
              autoFocus
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('tasks.milestones.status', 'Status')}>
              <MilestoneStatusPicker value={status} onChange={setStatus} />
            </Field>
            <Field label={t('tasks.milestones.dueDate', 'Due date')}>
              <DateInput
                value={dueDate}
                onChange={setDueDate}
                ariaLabel={t('tasks.milestones.dueDateLabel', 'Milestone due date')}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setAdding(false)}
              disabled={create.isPending}
            >
              {t('tasks.common.cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void submit()}
              disabled={create.isPending || name.trim() === ''}
            >
              {t('tasks.milestones.add', 'Add')}
            </Button>
          </div>
        </div>
      )}

      {errorMessage ? (
        <ErrorState message={errorMessage} onRetry={retry} size="lg" />
      ) : isLoading ? (
        <SkeletonBlock className="h-24" />
      ) : milestones.length === 0 && !adding ? (
        <EmptyState
          size="lg"
          variant="subtle"
          title={t('tasks.milestones.empty', 'No milestones yet')}
          description={t(
            'tasks.milestones.emptyHint',
            'Group tasks toward dated goals and track their progress.',
          )}
          actions={
            <Button type="button" size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {t('tasks.milestones.new', 'New milestone')}
            </Button>
          }
        />
      ) : (
        <div className={CARD_CLASS}>
          <div className={CARD_HEADER_CLASS}>
            <span className={CARD_CAPTION_CLASS}>{t('tasks.milestones.datedGoals', 'Dated goals')}</span>
            <CountBadge value={milestones.length} />
          </div>
          <ul className="divide-y divide-border">
            {milestones.map((milestone) => (
              <li key={milestone.id} className="flex items-center gap-4 px-3 py-4 sm:px-5">
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <p className="truncate text-sm font-semibold text-foreground">{milestone.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('tasks.milestones.summary', 'Due {due} · {done}/{total} tasks done', {
                        due: formatTaskDate(milestone.dueDate),
                        done: milestone.doneTaskCount,
                        total: milestone.taskCount,
                      })}
                    </p>
                  </div>
                  <ProgressBar value={milestone.progress} />
                </div>

                <div className="flex h-9 shrink-0 items-center gap-1.5">
                  <div className="w-36">
                    <MilestoneStatusPicker
                      value={milestone.status}
                      onChange={(value) =>
                        update.mutate(
                          { id: milestone.id, body: { status: value }, updatedAt: milestone.updatedAt },
                          {
                            onError: () =>
                              flash(
                                t('tasks.milestones.updateFailed', 'Could not update milestone.'),
                                'error',
                              ),
                          },
                        )
                      }
                    />
                  </div>
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="lg"
                    className="text-destructive"
                    aria-label={t('tasks.milestones.deleteLabel', 'Delete {name}', { name: milestone.name })}
                    onClick={() => void confirmDelete(milestone)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ConfirmDialogElement}
    </div>
  )
}
