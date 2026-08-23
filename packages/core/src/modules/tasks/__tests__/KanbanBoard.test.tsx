/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import type { DragEndEvent } from '@dnd-kit/core'
import { KanbanBoard } from '../components/KanbanBoard'
import type { TaskListItemDto, TaskStatus } from '../data/types'

/**
 * The board's wiring: a drop must reach the server, a rejected drop must say so,
 * and a drop that changes nothing must stay off the network. `resolveBoardDrop`
 * is unit-tested separately; these tests cover the part only the component owns.
 */

// Capture the handlers DndContext is given so a drag can be replayed without a
// real pointer — jsdom has no layout, so dnd-kit's own sensors cannot fire.
let dragHandlers: {
  onDragStart?: (event: { active: { id: string } }) => void
  onDragEnd?: (event: DragEndEvent) => void
  onDragCancel?: () => void
} = {}

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    ...handlers
  }: {
    children: React.ReactNode
  } & typeof dragHandlers) => {
    dragHandlers = handlers
    return <div>{children}</div>
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  KeyboardSensor: 'KeyboardSensor',
  PointerSensor: 'PointerSensor',
  closestCorners: jest.fn(),
  useDroppable: () => ({ setNodeRef: jest.fn(), isOver: false }),
  useSensor: jest.fn(),
  useSensors: (...sensors: unknown[]) => sensors,
}))

jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  sortableKeyboardCoordinates: jest.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  verticalListSortingStrategy: 'vertical',
}))

jest.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => undefined } } }))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/backend/tasks/projects/project-1',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

const flash = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flash(...args) }))

const moveMutate = jest.fn()
const board = { tasks: [] as TaskListItemDto[], isLoading: false, error: null as unknown, retry: jest.fn() }

jest.mock('../components/hooks', () => ({
  useBoard: () => board,
  useTaskError: (error: unknown, fallback: string) => (error ? fallback : null),
  useTaskMutations: () => ({ move: { mutate: moveMutate } }),
}))

function task(id: string, status: TaskStatus, rank: number): TaskListItemDto {
  return {
    id,
    number: 1,
    reference: `T-${id}`,
    title: `Task ${id}`,
    status,
    priority: 'none',
    rank,
    dueDate: null,
    dueTime: null,
    completedAt: null,
    projectId: 'project-1',
    projectKey: 'T',
    projectName: 'Test',
    projectIcon: null,
    parentTaskId: null,
    parentTaskTitle: null,
    milestoneId: null,
    milestoneName: null,
    assignees: [],
    assignmentTargets: [],
    labels: [],
    subtaskCount: 0,
    completedSubtaskCount: 0,
    commentCount: 0,
    recurrence: null,
    updatedAt: '2026-08-24T10:00:00.000Z',
  } as TaskListItemDto
}

function drop(activeId: string, overId: string | null): void {
  dragHandlers.onDragEnd?.({
    active: { id: activeId },
    over: overId ? { id: overId } : null,
  } as unknown as DragEndEvent)
}

function renderBoard(): void {
  render(<KanbanBoard projectId="project-1" onOpenTask={jest.fn()} onCreateTask={jest.fn()} />)
}

beforeEach(() => {
  jest.clearAllMocks()
  dragHandlers = {}
  board.tasks = [task('a', 'backlog', 1024), task('b', 'backlog', 2048), task('x', 'in_progress', 1024)]
  board.isLoading = false
  board.error = null
})

describe('rendering', () => {
  it('renders a column for every status', () => {
    renderBoard()
    for (const label of ['Backlog', 'To Do', 'In Progress', 'Blocked', 'In Review', 'Done', 'Cancelled']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('places each task in its own column', () => {
    renderBoard()
    expect(screen.getByText('Task a')).toBeInTheDocument()
    expect(screen.getByText('Task x')).toBeInTheDocument()
  })

  it('shows a retryable error instead of an empty board when loading failed', () => {
    board.error = new Error('boom')
    renderBoard()
    expect(screen.queryByText('Task a')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('shows a skeleton while loading', () => {
    board.isLoading = true
    renderBoard()
    expect(screen.queryByText('Task a')).not.toBeInTheDocument()
  })
})

describe('dropping a card', () => {
  it('sends the move to the server', () => {
    renderBoard()
    drop('a', 'in_progress')

    expect(moveMutate).toHaveBeenCalledTimes(1)
    expect(moveMutate.mock.calls[0]![0]).toEqual({
      id: 'a',
      status: 'in_progress',
      afterTaskId: 'x',
      updatedAt: '2026-08-24T10:00:00.000Z',
    })
  })

  it('sends a reorder within the same column', () => {
    renderBoard()
    drop('b', 'a')
    expect(moveMutate.mock.calls[0]![0]).toMatchObject({ status: 'backlog', afterTaskId: null })
  })

  it('stays off the network when the drop changes nothing', () => {
    renderBoard()
    drop('b', 'b')
    drop('a', null)
    expect(moveMutate).not.toHaveBeenCalled()
  })
})

describe('when the server refuses the move', () => {
  it('surfaces the reason rather than leaving the card where the browser put it', () => {
    renderBoard()
    drop('a', 'in_progress')

    const options = moveMutate.mock.calls[0]![1] as { onError: (error: Error) => void }
    options.onError(new Error('Someone else moved this task.'))

    expect(flash).toHaveBeenCalledWith('Someone else moved this task.', 'error')
  })

  it('falls back to its own message when the failure carries none', () => {
    renderBoard()
    drop('a', 'done')

    const options = moveMutate.mock.calls[0]![1] as { onError: (error: unknown) => void }
    options.onError({})

    expect(flash).toHaveBeenCalledWith('Could not move the task.', 'error')
  })
})
