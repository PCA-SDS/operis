/**
 * The shell's URL state keys. They live apart from `TasksShell` so plain
 * helpers can read them without importing the component tree.
 */
export const QUICK_ADD_PARAM = 'quickAdd'
export const PROJECT_FORM_PARAM = 'projectForm'
export const CALENDAR_PARAM = 'calendar'
/**
 * The task a personal view should open its detail panel on.
 *
 * Separate from `NEW_TASK_PARAM`, which only flashes a row that is already
 * visible. This one opens the panel, and it exists so anything outside the tasks
 * UI — a notification, a search hit, a task card in a chat conversation — has a
 * URL to link to. A query parameter rather than a path segment because
 * `/backend/tasks/<uuid>` belongs to the `workflows` user-task queue.
 */
export const TASK_PARAM = 'task'
