import { createdTaskDestination } from '../components/createdTaskDestination'

const TODAY = '2026-03-04'

function destination(pathname: string, search: string, dueDate: string | null) {
  return createdTaskDestination(pathname, search, { id: 'task-1', dueDate }, TODAY)
}

describe('createdTaskDestination', () => {
  it('stays on All Tasks, which shows everything', () => {
    expect(destination('/backend/tasks/all', '', null)).toBe('/backend/tasks/all?new=task-1')
  })

  it('stays on Today when the task is due today or earlier', () => {
    expect(destination('/backend/tasks/today', '', TODAY)).toBe('/backend/tasks/today?new=task-1')
    expect(destination('/backend/tasks/today', '', '2026-03-01')).toBe('/backend/tasks/today?new=task-1')
  })

  it('leaves Today when the task would not appear there', () => {
    expect(destination('/backend/tasks/today', '', '2026-04-01')).toBe('/backend/tasks/all?new=task-1')
    expect(destination('/backend/tasks/today', '', null)).toBe('/backend/tasks/all?new=task-1')
  })

  it('stays on Upcoming for any dated task', () => {
    expect(destination('/backend/tasks/upcoming', '', '2026-04-01')).toBe(
      '/backend/tasks/upcoming?new=task-1',
    )
  })

  it('leaves Upcoming for an undated task', () => {
    expect(destination('/backend/tasks/upcoming', '', null)).toBe('/backend/tasks/all?new=task-1')
  })

  it('falls back to All Tasks from a view that never lists new work', () => {
    expect(destination('/backend/tasks/completed', '', TODAY)).toBe('/backend/tasks/all?new=task-1')
    expect(destination('/backend/tasks/projects', '', TODAY)).toBe('/backend/tasks/all?new=task-1')
  })

  it('keeps the current filters when it stays put', () => {
    const result = destination('/backend/tasks/all', 'q=invoice', null)
    expect(result).toContain('q=invoice')
    expect(result).toContain('new=task-1')
  })

  it('drops the page number so the new task is not on a page you cannot see', () => {
    expect(destination('/backend/tasks/all', 'page=4', null)).toBe('/backend/tasks/all?new=task-1')
  })

  it('drops the old filters when it redirects', () => {
    expect(destination('/backend/tasks/today', 'q=invoice', null)).toBe('/backend/tasks/all?new=task-1')
  })

  it('closes Quick Add rather than reopening it over the task just created', () => {
    expect(destination('/backend/tasks/all', 'quickAdd=1', null)).toBe('/backend/tasks/all?new=task-1')
    expect(destination('/backend/tasks/today', 'quickAdd=1&q=invoice', TODAY)).toBe(
      '/backend/tasks/today?q=invoice&new=task-1',
    )
  })
})
