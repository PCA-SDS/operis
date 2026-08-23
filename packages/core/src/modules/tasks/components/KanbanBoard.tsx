"use client"

import * as React from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { TaskListItemDto, TaskStatus } from '../data/types'
import { StatusHeadline } from './badges'
import { TaskCard } from './TaskCard'
import { AddTaskRow, CARD_CLASS, CARD_HEADER_CLASS, ErrorState, SkeletonBlock } from './ui-bits'
import { resolveBoardDrop } from './boardDrop'
import { TASK_STATUS_META, TASK_STATUS_ORDER } from './format'
import { useBoard, useTaskError, useTaskMutations } from './hooks'
import { useNewTaskFlash } from './useNewTaskFlash'

/**
 * The Kanban board. Ordering is persisted server-side as a fractional rank, so
 * a drop writes one row rather than renumbering a column — and the query is
 * invalidated on settle, which is what makes a rejected move snap back instead
 * of leaving the card where the browser put it.
 */
export function KanbanBoard({
  projectId,
  onOpenTask,
  onCreateTask,
}: {
  projectId: string
  onOpenTask: (id: string) => void
  onCreateTask: (status: TaskStatus) => void
}) {
  const t = useT()
  const { tasks, isLoading, error, retry } = useBoard(projectId)
  const errorMessage = useTaskError(error, t('tasks.common.loadFailed', "This didn't load"))
  const { move } = useTaskMutations(projectId)
  const { flashTaskId, flashRef } = useNewTaskFlash()
  const [activeId, setActiveId] = React.useState<string | null>(null)

  const sensors = useSensors(
    // A small distance threshold keeps a click on a card from being read as a
    // drag, so opening a task still works.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const columns = React.useMemo(() => {
    const byStatus = new Map<TaskStatus, TaskListItemDto[]>()
    for (const status of TASK_STATUS_ORDER) byStatus.set(status, [])
    for (const task of [...tasks].sort((a, b) => a.rank - b.rank)) {
      byStatus.get(task.status)?.push(task)
    }
    return byStatus
  }, [tasks])

  const activeTask = activeId ? (tasks.find((task) => task.id === activeId) ?? null) : null

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    const drop = resolveBoardDrop(tasks, String(active.id), over ? String(over.id) : null)
    if (!drop) return

    move.mutate(drop, {
      onError: (mutationError) =>
        flash(
          mutationError instanceof Error && mutationError.message
            ? mutationError.message
            : t('tasks.board.moveFailed', 'Could not move the task.'),
          'error',
        ),
    })
  }

  if (errorMessage) return <ErrorState message={errorMessage} onRetry={retry} size="lg" />
  if (isLoading) return <SkeletonBlock className="min-h-0 flex-1" />

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(event: DragStartEvent) => setActiveId(String(event.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
        {TASK_STATUS_ORDER.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            tasks={columns.get(status) ?? []}
            onOpenTask={onOpenTask}
            onCreateTask={onCreateTask}
            flashTaskId={flashTaskId}
            flashRef={flashRef}
          />
        ))}
      </div>

      {/* The overlay is what the pointer carries; the source card stays in place
          at reduced opacity so the column does not reflow mid-drag. */}
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="w-72 rotate-1">
            <TaskCard task={activeTask} onOpen={() => undefined} interaction="drag" overlay />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function BoardColumn({
  status,
  tasks,
  onOpenTask,
  onCreateTask,
  flashTaskId,
  flashRef,
}: {
  status: TaskStatus
  tasks: TaskListItemDto[]
  onOpenTask: (id: string) => void
  onCreateTask: (status: TaskStatus) => void
  flashTaskId: string | null
  flashRef: (node: HTMLElement | null) => void
}) {
  const t = useT()
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const meta = TASK_STATUS_META[status]

  return (
    <div className={cn(CARD_CLASS, 'flex h-full min-h-0 w-70 shrink-0 flex-col')}>
      <div className={cn(CARD_HEADER_CLASS, 'shrink-0 sm:px-3')}>
        <StatusHeadline status={status} count={tasks.length} />
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition-colors',
          isOver && 'bg-primary-soft',
        )}
      >
        <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              onOpen={onOpenTask}
              isFlashing={task.id === flashTaskId}
              flashRef={task.id === flashTaskId ? flashRef : null}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <EmptyState
            variant="subtle"
            size="sm"
            title={t('tasks.board.emptyColumn', 'Nothing in this column')}
            description={t('tasks.board.emptyColumnHint', 'Drag a task here to move it to {status}.', {
              status: t(meta.labelKey, meta.fallback),
            })}
          />
        )}

        <AddTaskRow
          variant="compact"
          label={t('tasks.common.addTask', 'Add task')}
          onClick={() => onCreateTask(status)}
        />
      </div>
    </div>
  )
}

function SortableTaskCard({
  task,
  onOpen,
  isFlashing,
  flashRef,
}: {
  task: TaskListItemDto
  onOpen: (id: string) => void
  isFlashing: boolean
  flashRef: ((node: HTMLElement | null) => void) | null
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-40' : undefined}
      {...attributes}
      {...listeners}
    >
      <TaskCard
        task={task}
        onOpen={onOpen}
        interaction="drag"
        isFlashing={isFlashing}
        flashRef={flashRef}
      />
    </div>
  )
}
