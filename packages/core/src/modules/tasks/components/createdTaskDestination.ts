import { localTodayIso } from './format'
import { NEW_TASK_PARAM } from './useNewTaskFlash'

export type CreatedTaskLocation = {
  id: string
  dueDate: string | null
}

/**
 * Where to send someone after Quick Add creates a task.
 *
 * If the current view would show the new task, stay put and just flag it — a
 * jump away from a list you were working in is disorienting. Otherwise fall
 * back to All Tasks, which shows everything, so a task created from a view it
 * does not belong in is never silently invisible.
 */
export function createdTaskDestination(
  pathname: string,
  search: string,
  task: CreatedTaskLocation,
  today: string = localTodayIso(),
): string {
  const dueDate = task.dueDate?.slice(0, 10) ?? null
  const staysPut =
    pathname === '/backend/tasks/all' ||
    (pathname === '/backend/tasks/today' && dueDate !== null && dueDate <= today) ||
    (pathname === '/backend/tasks/upcoming' && dueDate !== null)

  const params = new URLSearchParams(staysPut ? search : '')
  params.delete('page')
  params.set(NEW_TASK_PARAM, task.id)
  return `${staysPut ? pathname : '/backend/tasks/all'}?${params.toString()}`
}
