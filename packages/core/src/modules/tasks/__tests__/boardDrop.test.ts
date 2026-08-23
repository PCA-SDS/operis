import { resolveBoardDrop } from '../components/boardDrop'
import type { TaskListItemDto, TaskStatus } from '../data/types'

function task(id: string, status: TaskStatus, rank: number): TaskListItemDto {
  return {
    id,
    number: 1,
    reference: `T-${id}`,
    title: id,
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
    updatedAt: `2026-08-24T10:00:00.000Z`,
  } as TaskListItemDto
}

// Two columns, deliberately out of rank order in the array so the resolver has
// to sort rather than trust insertion order.
const board = [
  task('b', 'backlog', 2048),
  task('a', 'backlog', 1024),
  task('c', 'backlog', 3072),
  task('x', 'in_progress', 1024),
  task('y', 'in_progress', 2048),
]

describe('dropping on a column', () => {
  it('appends to the end of the target column', () => {
    expect(resolveBoardDrop(board, 'a', 'in_progress')).toEqual({
      id: 'a',
      status: 'in_progress',
      afterTaskId: 'y',
      updatedAt: board[1]!.updatedAt,
    })
  })

  it('reports no predecessor when the target column is empty', () => {
    expect(resolveBoardDrop(board, 'a', 'done')).toEqual({
      id: 'a',
      status: 'done',
      afterTaskId: null,
      updatedAt: board[1]!.updatedAt,
    })
  })

  it('ignores the dragged card when finding the last position in its own column', () => {
    // 'c' is already last in backlog, so appending to backlog should place it
    // after 'b' — not after itself.
    expect(resolveBoardDrop(board, 'b', 'backlog')).toEqual({
      id: 'b',
      status: 'backlog',
      afterTaskId: 'c',
      updatedAt: board[0]!.updatedAt,
    })
  })
})

describe('dropping on a card', () => {
  it('places the card before the one it landed on', () => {
    // Landing on 'y' means "take y's place", so the predecessor is 'x'.
    expect(resolveBoardDrop(board, 'a', 'y')).toMatchObject({
      status: 'in_progress',
      afterTaskId: 'x',
    })
  })

  it('places the card first when it lands on the top card', () => {
    expect(resolveBoardDrop(board, 'a', 'x')).toMatchObject({
      status: 'in_progress',
      afterTaskId: null,
    })
  })

  it('resolves the target column from the card, not the pointer', () => {
    expect(resolveBoardDrop(board, 'x', 'c')).toMatchObject({ status: 'backlog', afterTaskId: 'b' })
  })
})

describe('drops that are not moves', () => {
  it('returns null when nothing was under the pointer', () => {
    expect(resolveBoardDrop(board, 'a', null)).toBeNull()
  })

  it('returns null when the card lands back in its own place', () => {
    // 'b' sits between 'a' and 'c'; landing on 'b' asks for the same position.
    expect(resolveBoardDrop(board, 'b', 'b')).toBeNull()
  })

  it('returns null when the top card is dropped on itself', () => {
    expect(resolveBoardDrop(board, 'a', 'a')).toBeNull()
  })

  it('returns null for an unknown droppable id', () => {
    expect(resolveBoardDrop(board, 'a', 'not-a-thing')).toBeNull()
  })

  it('returns null when the dragged id is not on the board', () => {
    expect(resolveBoardDrop(board, 'ghost', 'backlog')).toBeNull()
  })
})

describe('the payload the server needs', () => {
  it('carries the card version so a stale board cannot overwrite a newer move', () => {
    const stale = [task('a', 'backlog', 1024)]
    stale[0]!.updatedAt = '2026-08-24T09:00:00.000Z'
    expect(resolveBoardDrop(stale, 'a', 'done')?.updatedAt).toBe('2026-08-24T09:00:00.000Z')
  })

  it('names a neighbour rather than an index', () => {
    // The server bisects between neighbours; an index would force a renumber.
    const drop = resolveBoardDrop(board, 'a', 'y')
    expect(typeof drop?.afterTaskId).toBe('string')
    expect(drop).not.toHaveProperty('index')
  })
})
