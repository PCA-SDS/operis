"use client"

import * as React from 'react'
import {
  Calendar,
  CircleDashed,
  Clock,
  CornerDownRight,
  Flag,
  Milestone as MilestoneIcon,
  Repeat2,
  Tag,
  Trash2,
  User,
} from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { TaskPriority, TaskRecurrenceDto, TaskStatus } from '../data/types'
import { extensionPoints } from '../extension-points'
import type { TaskAssignmentTargetInput } from './assignmentTypes'
import { AssignPicker } from './AssignPicker'
import { Chip, LabelPill } from './badges'
import { CommentsThread } from './CommentsThread'
import { RichTextEditor, type RichTextValue } from './RichText'
import { StatusSelect } from './StatusSelect'
import { SubtaskSection } from './SubtaskSection'
import { TaskLabelPicker } from './TaskLabelPicker'
import { MilestonePicker, RecurrencePicker, TaskPriorityPicker } from './pickers'
import {
  CARD_CAPTION_CLASS,
  DateInput,
  ErrorBanner,
  ErrorState,
  SkeletonBlock,
  TimeInput,
  TitleInput,
  UserAvatar,
} from './ui-bits'
import { browserTimeZone, formatTaskDate, isOverdue, taskRef } from './format'
import { tasksApi } from './api'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { useMilestones, useTask, useTaskError, useTaskMutations } from './hooks'

type CreateDraft = {
  title: string
  status: TaskStatus
  priority: TaskPriority
  assigneeIds: string[]
  assignmentTargets: TaskAssignmentTargetInput[]
  dueDate: string | null
  dueTime: string | null
  recurrence: TaskRecurrenceDto | null
  milestoneId: string | null
  labelIds: string[]
  description: string
  descriptionPlaintext: string
}

function emptyDraft(
  defaultStatus: TaskStatus,
  defaultDueDate: string | null = null,
  defaultDueTime: string | null = null,
): CreateDraft {
  return {
    title: '',
    status: defaultStatus,
    priority: 'none',
    assigneeIds: [],
    assignmentTargets: [],
    dueDate: defaultDueDate,
    dueTime: defaultDueTime,
    recurrence: null,
    milestoneId: null,
    labelIds: [],
    description: '',
    descriptionPlaintext: '',
  }
}

/**
 * The task surface. One component covers both jobs because they show the same
 * fields: with an id it edits in place (each control saves on change), without
 * one it collects a draft and creates on submit.
 *
 * Editing saves per field rather than behind a Save button — a task is a living
 * record people nudge constantly, and a form gate would make every nudge a
 * two-step operation.
 */
export function TaskPanel({
  taskId,
  projectId,
  defaultStatus = 'backlog',
  defaultDueDate = null,
  defaultDueTime = null,
  onClose,
  onCreated,
}: {
  taskId: string | null
  projectId: string
  defaultStatus?: TaskStatus
  /** Seeds a new task's due date (`YYYY-MM-DD`) — a calendar opening the panel
   *  on a slot passes the slot it was opened from. */
  defaultDueDate?: string | null
  /** Seeds a new task's wall-clock due time (`HH:MM`). */
  defaultDueTime?: string | null
  onClose: () => void
  onCreated?: (taskId: string) => void
}) {
  const t = useT()
  const isCreate = taskId === null
  const [activeId, setActiveId] = React.useState(taskId)
  const [subtaskComposer, setSubtaskComposer] = React.useState(false)
  const [banner, setBanner] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<CreateDraft>(() =>
    emptyDraft(defaultStatus, defaultDueDate, defaultDueTime),
  )
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  React.useEffect(() => setActiveId(taskId), [taskId])
  React.useEffect(() => setSubtaskComposer(false), [activeId])

  const { task, isLoading, error, retry } = useTask(activeId ?? undefined)
  const errorMessage = useTaskError(error, t('tasks.common.loadFailed', "This didn't load"))
  const { milestones } = useMilestones(projectId)
  const { create, update, remove } = useTaskMutations(projectId)

  const busyCreate = create.isPending

  const patch = (body: Record<string, unknown>) => {
    if (!activeId || !task) return
    update.mutate(
      { id: activeId, body, updatedAt: task.updatedAt },
      {
        onError: (mutationError) =>
          flash(
            mutationError instanceof Error && mutationError.message
              ? mutationError.message
              : t('tasks.panel.saveFailed', 'Could not save.'),
            'error',
          ),
      },
    )
  }

  /**
   * Fields the user has set by hand. Quick Add fills the rest.
   *
   * This is the composer's `UNSET` rule in the shape this form needs: there the
   * absence of an override means "the parser may fill this in", here the
   * absence of a touch means the same. Without it, typing one more word in the
   * quick-add line would undo a picker the user had already set.
   */
  const touchedRef = React.useRef(new Set<keyof CreateDraft>())

  const setField = <K extends keyof CreateDraft>(key: K, value: CreateDraft[K]) => {
    touchedRef.current.add(key)
    setDraft((previous) => ({ ...previous, [key]: value }))
  }

  /** Writes a parsed value only where the user has not already decided. */
  const fillUntouched = React.useCallback((values: Partial<CreateDraft>) => {
    setDraft((previous) => {
      const next = { ...previous }
      for (const [key, value] of Object.entries(values)) {
        if (touchedRef.current.has(key as keyof CreateDraft)) continue
        Object.assign(next, { [key]: value })
      }
      return next
    })
  }, [])

  const [quickAddText, setQuickAddText] = React.useState('')

  // Same two-step the composer uses: the server resolves `#project`, `@person`
  // and `@label` to real records, which no client-side parse can do.
  React.useEffect(() => {
    if (!isCreate) return
    const line = quickAddText.trim()
    if (line.length === 0) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const parsed = await tasksApi.parseQuickAdd({ text: line, tz: browserTimeZone() }, controller.signal)
        fillUntouched({
          title: parsed.title,
          dueDate: parsed.dueDate,
          dueTime: parsed.dueTime,
          recurrence: parsed.recurrence,
          priority: parsed.priority ?? 'none',
          labelIds: parsed.labels.map((label) => label.id),
          assigneeIds: parsed.assignee ? [parsed.assignee.id] : [],
        })
      } catch {
        // A failed parse leaves the fields as the user last had them; the line
        // itself is still there to submit or correct.
      }
    }, 250)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [isCreate, quickAddText, fillUntouched])

  const submitCreate = async () => {
    const title = draft.title.trim()
    if (title === '') return
    setBanner(null)
    try {
      const created = await create.mutateAsync({
        projectId,
        body: {
          title,
          status: draft.status,
          priority: draft.priority,
          assigneeIds: draft.assigneeIds,
          assignmentTargets: draft.assignmentTargets,
          milestoneId: draft.milestoneId,
          dueDate: draft.dueDate,
          dueTime: draft.dueDate ? draft.dueTime : null,
          recurrence: draft.recurrence,
          tz: browserTimeZone(),
          labelIds: draft.labelIds,
          description: draft.description || null,
          descriptionPlaintext: draft.descriptionPlaintext || null,
        },
      })
      flash(t('tasks.panel.created.toast', 'Task created.'), 'success')
      onCreated?.(created.id)
      onClose()
    } catch (createError) {
      setBanner(
        createError instanceof Error && createError.message
          ? createError.message
          : t('tasks.panel.createFailed', 'Could not create the task.'),
      )
    }
  }

  const confirmDelete = async () => {
    if (!task) return
    const ok = await confirm({
      title: t('tasks.panel.deleteTitle', 'Delete task?'),
      description:
        task.subtasks.length > 0
          ? t(
              'tasks.panel.deleteBodyWithSubtasks',
              'This permanently deletes {ref}, its comments and every subtask under it.',
              { ref: taskRef(task.projectKey, task.number) },
            )
          : t('tasks.panel.deleteBody', 'This permanently deletes {ref} and its comments.', {
              ref: taskRef(task.projectKey, task.number),
            }),
      confirmText: t('tasks.common.delete', 'Delete'),
      variant: 'destructive',
    })
    if (!ok) return

    const parentId = task.parentTaskId
    remove.mutate(
      { id: task.id, updatedAt: task.updatedAt },
      {
        onSuccess: () => {
          flash(t('tasks.panel.deleted', 'Task deleted.'), 'success')
          // Deleting a subtask you drilled into returns you to its parent
          // rather than dumping you back on the list you came from.
          if (activeId !== taskId && parentId) setActiveId(parentId)
          else onClose()
        },
        onError: () => flash(t('tasks.panel.deleteFailed', 'Could not delete the task.'), 'error'),
      },
    )
  }

  const status = isCreate ? draft.status : (task?.status ?? defaultStatus)
  const priority = isCreate ? draft.priority : (task?.priority ?? 'none')
  const assigneeIds = isCreate ? draft.assigneeIds : (task?.assignees.map((person) => person.id) ?? [])
  const assignmentTargets: TaskAssignmentTargetInput[] = isCreate
    ? draft.assignmentTargets
    : (task?.assignmentTargets.map((target) => ({ kind: 'role' as const, roleId: target.role?.id })) ?? [])
  const dueDate = isCreate ? draft.dueDate : (task?.dueDate ?? null)
  const dueTime = isCreate ? draft.dueTime : (task?.dueTime ?? null)
  const recurrence = isCreate ? draft.recurrence : (task?.recurrence ?? null)
  const milestoneId = isCreate ? draft.milestoneId : (task?.milestoneId ?? null)
  const labelIds = isCreate ? draft.labelIds : (task?.labels.map((label) => label.id) ?? [])

  const showError = !isCreate && errorMessage
  const showLoading = !isCreate && (isLoading || !task)

  const attributes = (
    <AttrRowFillsCell.Provider value={isCreate}>
    <div className={isCreate ? 'grid gap-x-8 gap-y-3 sm:grid-cols-2' : 'grid gap-y-1.5'}>
      <AttrRow icon={CircleDashed} label={t('tasks.panel.status', 'Status')}>
        <StatusSelect
          value={status}
          dense
          onChange={(value) => (isCreate ? setField('status', value) : patch({ status: value }))}
        />
      </AttrRow>

      <AttrRow icon={User} label={t('tasks.panel.assignees', 'Assignees')} fill>
        <AssignPicker
          assigneeIds={assigneeIds}
          targets={assignmentTargets}
          onChange={(nextIds, nextTargets) => {
            if (isCreate) {
              setField('assigneeIds', nextIds)
              setField('assignmentTargets', nextTargets)
            } else {
              patch({ assigneeIds: nextIds, assignmentTargets: nextTargets })
            }
          }}
        />
      </AttrRow>

      <AttrRow icon={Calendar} label={t('tasks.panel.dueDate', 'Due date')}>
        <DateInput
          value={dueDate ?? ''}
          onChange={(value) => {
            const next = value || null
            if (isCreate) setField('dueDate', next)
            else patch({ dueDate: next })
          }}
          invalid={isOverdue(dueDate)}
          ariaLabel={t('tasks.panel.dueDateLabel', 'Task due date')}
          placeholder={t('tasks.panel.noDueDate', 'No due date')}
          variant="dense"
        />
      </AttrRow>

      <AttrRow icon={Clock} label={t('tasks.panel.dueTime', 'Due time')}>
        <TimeInput
          value={dueTime ?? ''}
          onChange={(value) => {
            const next = value || null
            if (isCreate) setField('dueTime', next)
            else patch({ dueTime: next })
          }}
          disabled={dueDate === null}
          ariaLabel={t('tasks.panel.dueTimeLabel', 'Task due time')}
          placeholder={t('tasks.panel.noDueTime', 'No time')}
          variant="dense"
        />
      </AttrRow>

      <AttrRow icon={Repeat2} label={t('tasks.panel.repeats', 'Repeats')}>
        <RecurrencePicker
          value={recurrence}
          dense
          onChange={(value) =>
            isCreate ? setField('recurrence', value) : patch({ recurrence: value, tz: browserTimeZone() })
          }
        />
      </AttrRow>

      <AttrRow icon={Flag} label={t('tasks.panel.priority', 'Priority')}>
        <TaskPriorityPicker
          value={priority}
          dense
          onChange={(value) => (isCreate ? setField('priority', value) : patch({ priority: value }))}
        />
      </AttrRow>

      <AttrRow icon={MilestoneIcon} label={t('tasks.panel.milestone', 'Milestone')}>
        <MilestonePicker
          value={milestoneId}
          milestones={milestones}
          dense
          onChange={(value) => (isCreate ? setField('milestoneId', value) : patch({ milestoneId: value }))}
        />
      </AttrRow>

      <AttrRow icon={Tag} label={t('tasks.panel.labels', 'Labels')} fill>
        <div className="flex min-h-8 flex-wrap items-center gap-1.5">
          {!isCreate &&
            task?.labels.map((label) => (
              <LabelPill
                key={label.id}
                label={label}
                size="md"
                onRemove={() => patch({ labelIds: labelIds.filter((id) => id !== label.id) })}
              />
            ))}
          <TaskLabelPicker
            value={labelIds}
            dense
            onChange={(ids) => (isCreate ? setField('labelIds', ids) : patch({ labelIds: ids }))}
          />
        </div>
      </AttrRow>
    </div>
    </AttrRowFillsCell.Provider>
  )

  return (
    <>
      <Dialog open onOpenChange={(open) => (open || busyCreate ? undefined : onClose())}>
        <DialogContent
          disableBodyWrap
          // Create mode takes the DS close button, like the event editor;
          // detail mode draws its own header row with Delete and Close.
          dismissible={isCreate}
          closeAriaLabel={t('tasks.common.cancel', 'Cancel')}
          className={cn(
            'flex flex-col gap-0 overflow-hidden p-0',
            isCreate
              // One step past the event editor's `xl` (`max-w-4xl`). The form
              // lays out in two columns and the parse bar spans both, so it
              // earns the extra width. A standard scale step, not an arbitrary
              // value — `sm:` so the mobile sheet still goes full-bleed.
              ? 'max-h-[calc(100dvh-4rem)] sm:max-w-5xl'
              : 'h-full max-h-[calc(100dvh-2.5rem)] max-w-[80rem]',
          )}
        >
          {isCreate ? (
            <DialogHeader>
              <DialogTitle>{t('tasks.panel.newTask', 'New task')}</DialogTitle>
            </DialogHeader>
          ) : (
            <header className="flex shrink-0 items-center justify-between gap-2 px-4 py-2.5">
              <DialogTitle className="font-mono text-xs font-normal text-muted-foreground">
                {task ? taskRef(task.projectKey, task.number) : t('tasks.panel.detailLabel', 'Task detail')}
              </DialogTitle>
              <div className="flex items-center gap-1">
                <IconButton
                  type="button"
                  variant="ghost"
                  size="lg"
                  aria-label={t('tasks.panel.deleteTask', 'Delete task')}
                  className="text-destructive"
                  onClick={() => void confirmDelete()}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
                <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                  {t('tasks.panel.closeTask', 'Close task')}
                </Button>
              </div>
            </header>
          )}

          {showError ? (
            <div className="px-5 pb-5 sm:px-6">
              <ErrorState message={errorMessage as string} onRetry={retry} />
            </div>
          ) : showLoading ? (
            <div className="space-y-3 p-6">
              <SkeletonBlock className="h-8 w-3/4" />
              <SkeletonBlock className="h-40" />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
              <div className="min-w-0 flex-1 lg:overflow-y-auto">
                <BodyColumn isCreate={isCreate}>
                  {banner && <ErrorBanner>{banner}</ErrorBanner>}

                  {isCreate ? (
                    <>
                      {/* Quick Add, the same line the composer takes. Typing
                          `#project @alice @label p1 tomorrow 3pm` fills the
                          controls below; anything set by hand there wins and is
                          left alone. The title field keeps the cleaned text, so
                          the tokens never end up in the task's name. */}
                      <div className="flex flex-col gap-1.5">
                        <SearchInput
                          value={quickAddText}
                          onChange={setQuickAddText}
                          placeholder={t(
                            'tasks.panel.quickAddPlaceholder',
                            'Quick add — try "Fix login #web @alice p1 tomorrow 3pm"',
                          )}
                          aria-label={t('tasks.panel.quickAdd', 'Quick add')}
                          // The entry point for the form, so it takes the
                          // focus the title used to. It also has to: TitleInput
                          // holds its own text and only re-syncs from its prop
                          // while unfocused, so a parse could never reach a
                          // title the caret was already sitting in.
                          autoFocus
                        />
                        {/* Not CARD_CAPTION_CLASS: that is the uppercase field
                            caption used for DESCRIPTION, and a whole sentence
                            set in it shouts. */}
                        <p className="text-xs leading-4 text-muted-foreground">
                          {t(
                            'tasks.panel.quickAddHint',
                            'Recognised tokens fill the fields below. Edit any field to keep your own value.',
                          )}
                        </p>
                      </div>
                      <TitleInput
                        value={draft.title}
                        onChange={(value) => setField('title', value)}
                        placeholder={t('tasks.panel.titlePlaceholder', 'Task title')}
                        minHeightClass="min-h-18"
                      />
                    </>
                  ) : (
                    <div className="space-y-2">
                      {task?.parent && (
                        <div className="flex">
                          <Chip
                            size="md"
                            onRemove={() => patch({ parentTaskId: null })}
                            removeLabel={t('tasks.panel.removeFromParent', 'Remove from parent task')}
                          >
                            <CornerDownRight className="size-3 shrink-0" aria-hidden="true" />
                            <button
                              type="button"
                              onClick={() => setActiveId(task.parent!.id)}
                              className="min-w-0 truncate transition-colors hover:text-foreground focus:outline-none focus-visible:shadow-focus"
                            >
                              <span className="font-mono">
                                {taskRef(task.projectKey, task.parent.number)}
                              </span>{' '}
                              {task.parent.title}
                            </button>
                          </Chip>
                        </div>
                      )}
                      <TitleInput
                        value={task?.title ?? ''}
                        onCommit={(value) => patch({ title: value })}
                        placeholder={t('tasks.panel.titlePlaceholder', 'Task title')}
                      />
                    </div>
                  )}

                  {isCreate ? (
                    <>
                      {attributes}
                      <div className="space-y-2.5">
                        <span className={CARD_CAPTION_CLASS}>{t('tasks.panel.description', 'Description')}</span>
                        <RichTextEditor
                          value={draft.description}
                          minRows={6}
                          onChange={(value: RichTextValue) =>
                            setDraft((previous) => ({
                              ...previous,
                              description: value.html,
                              descriptionPlaintext: value.text,
                            }))
                          }
                          placeholder={t('tasks.panel.descriptionPlaceholder', 'Add a description…')}
                        />
                      </div>
                    </>
                  ) : (
                    <RichTextEditor
                      value={task?.description ?? ''}
                      minRows={3}
                      onBlur={(value: RichTextValue) =>
                        patch({ description: value.html, descriptionPlaintext: value.text })
                      }
                      placeholder={t('tasks.panel.descriptionPlaceholder', 'Add a description…')}
                    />
                  )}

                  {!isCreate && task && (
                    <SubtaskSection
                      task={task}
                      projectId={projectId}
                      composing={subtaskComposer}
                      onComposingChange={setSubtaskComposer}
                      onOpenTask={setActiveId}
                    />
                  )}

                  {!isCreate && task && (
                    <section aria-label={t('tasks.panel.comments', 'Comments')} className="border-t border-border pt-5">
                      <CommentsThread taskId={task.id} />
                    </section>
                  )}
                </BodyColumn>
              </div>

              {!isCreate && task && (
                <aside
                  aria-label={t('tasks.panel.properties', 'Properties')}
                  className="border-t border-border lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-t-0 xl:w-88"
                >
                  <div className="space-y-5 px-5 py-6">
                    <section aria-label={t('tasks.panel.properties', 'Properties')} className="space-y-3">
                      <h3 className={CARD_CAPTION_CLASS}>{t('tasks.panel.properties', 'Properties')}</h3>
                      {attributes}
                    </section>

                    <div className="space-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
                      <PersonLine label={t('tasks.panel.reporter', 'Reporter')} name={task.reporter?.name} />
                      <PersonLine
                        label={t('tasks.panel.reviewer', 'Reviewer')}
                        name={task.reviewer?.name}
                        title={t('tasks.panel.reviewerHint', 'Whoever assigned the task reviews it.')}
                      />
                      <div className="flex items-center gap-3">
                        <span className="w-24 shrink-0">{t('tasks.panel.created', 'Created')}</span>
                        <span className="text-foreground">{formatTaskDate(task.createdAt)}</span>
                      </div>
                    </div>

                    {/* Where other modules hang task-scoped surfaces —
                        attachments, a linked CRM record, an integration panel.
                        Renders nothing when no module contributes. */}
                    <InjectionSpot
                      spotId={extensionPoints.hosts.taskPanelSidebar.spotId}
                      context={{
                        entityId: 'tasks:tasks_task',
                        recordId: task.id,
                        projectId: task.projectId,
                      }}
                    />
                  </div>
                </aside>
              )}
            </div>
          )}

          {isCreate && (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busyCreate}>
                {t('tasks.common.cancel', 'Cancel')}
              </Button>
              <Button
                type="button"
                onClick={() => void submitCreate()}
                disabled={busyCreate || draft.title.trim() === ''}
              >
                {t('tasks.panel.createTask', 'Create task')}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </>
  )
}

/**
 * Whether a row's control spans its cell.
 *
 * Detail mode stacks the rows down a narrow sidebar, where an unbounded control
 * reads badly, so it caps them. Create mode lays them out in a two-column grid
 * that already bounds each cell — there the cap just leaves every control's
 * right edge in a different place depending on whether the row asked to fill,
 * which is the ragged edge down the middle of the form.
 */
const AttrRowFillsCell = React.createContext(false)

function AttrRow({
  icon: Icon,
  label,
  fill = false,
  children,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  label: string
  fill?: boolean
  children: React.ReactNode
}) {
  const fillsCell = React.useContext(AttrRowFillsCell)
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-8 w-24 shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      <div className={cn('min-w-0 flex-1', !fill && !fillsCell && 'max-w-52')}>{children}</div>
    </div>
  )
}

function PersonLine({ label, name, title }: { label: string; name?: string | null; title?: string }) {
  return (
    <div className="flex items-center gap-3" title={title}>
      <span className="w-24 shrink-0">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <UserAvatar name={name ?? null} size="xs" />
        <span className="truncate text-foreground">{name ?? '—'}</span>
      </span>
    </div>
  )
}

/**
 * The body column. Create mode is a form, so it takes the DS `DialogBody` and
 * the same padding rhythm as the event editor; detail mode keeps its own
 * centred reading column, which is a different job.
 */
function BodyColumn({ isCreate, children }: { isCreate: boolean; children: React.ReactNode }) {
  if (isCreate) return <DialogBody className="space-y-5">{children}</DialogBody>
  return <div className="mx-auto w-full max-w-3xl space-y-6 px-5 py-6 sm:px-6">{children}</div>
}
