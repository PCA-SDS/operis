import type { TaskListItemDto, TaskStatus } from '../data/types'
import { TASK_STATUS_ORDER } from './format'

export type BoardDrop = {
  id: string
  status: TaskStatus
  afterTaskId: string | null
  updatedAt?: string | null
}

function isStatus(value: string): value is TaskStatus {
  return (TASK_STATUS_ORDER as readonly string[]).includes(value)
}

/** The column a droppable id belongs to — a column id, or the card's own column. */
function containerOf(tasks: TaskListItemDto[], id: string): TaskStatus | null {
  if (isStatus(id)) return id
  return tasks.find((task) => task.id === id)?.status ?? null
}

/**
 * Turn a drop into the write it implies, or `null` when it implies none.
 *
 * The board sends `afterTaskId` rather than an index because the server stores a
 * fractional rank: naming the neighbour lets it bisect and write one row instead
 * of renumbering the column. Returning `null` for a drop that lands where the
 * card already was is what keeps a stray click off the network.
 */
export function resolveBoardDrop(
  tasks: TaskListItemDto[],
  activeId: string,
  overId: string | null,
): BoardDrop | null {
  if (!overId) return null

  // dnd-kit reports the dragged card as its own drop target when the pointer
  // never leaves it — a short drag that goes nowhere. Without this the card
  // would be filtered out of its own column and resolve to "move to the top".
  if (overId === activeId) return null

  const target = containerOf(tasks, overId)
  if (!target) return null

  const ordered = [...tasks].sort((a, b) => a.rank - b.rank)
  const columnIds = ordered
    .filter((task) => task.status === target && task.id !== activeId)
    .map((task) => task.id)

  // Dropping on the column itself (rather than on a card) means "append".
  let afterTaskId: string | null
  if (isStatus(overId)) {
    afterTaskId = columnIds[columnIds.length - 1] ?? null
  } else {
    const overIndex = columnIds.indexOf(overId)
    afterTaskId = overIndex <= 0 ? null : (columnIds[overIndex - 1] ?? null)
  }

  const current = ordered.find((task) => task.id === activeId)
  if (!current) return null

  if (current.status === target) {
    const currentColumn = ordered.filter((task) => task.status === target).map((task) => task.id)
    const from = currentColumn.indexOf(activeId)
    const targetAfterIndex = afterTaskId ? currentColumn.indexOf(afterTaskId) : -1
    if (from === targetAfterIndex + 1) return null
  }

  return { id: activeId, status: target, afterTaskId, updatedAt: current.updatedAt }
}
