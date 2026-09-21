import { TASK_PARAM } from '@open-mercato/core/modules/tasks/components/shellParams'

/**
 * Where a task opens.
 *
 * The tasks module has no task-detail route: its panel is opened from local state
 * in five places, and a search hit navigates to the containing project's list tab
 * rather than to the task. So a card cannot invent a URL — it has to use one the
 * module already serves, with a parameter the module already reads.
 *
 * `/backend/tasks/all?task=<id>` is that: `all` is an existing static page of the
 * tasks module, `task` is read by `MyTasksView`, and the panel it opens fetches
 * the task over the module's own authorized route — so a link is a request, never
 * a grant. Using a path segment instead would collide with the `workflows`
 * user-task queue, which owns `/backend/tasks/{id}`.
 *
 * `projectId` is accepted and currently unused. It is here because the only other
 * surface that could host the panel is the project detail page, and a caller that
 * has the project should not have to be changed if that becomes the destination.
 */
export function taskHref(projectId: string, taskId: string): string {
  void projectId
  return `/backend/tasks/all?${TASK_PARAM}=${encodeURIComponent(taskId)}`
}

/** Where a conversation opens. */
export function conversationHref(conversationId: string): string {
  return `/backend/chat/${conversationId}`
}

/** The personal workspace — this module's own surface, not a conversation. */
export const CHAT_TASKS_WORKSPACE_HREF = '/backend/chat/workspace'

/** Tasks assigned to the caller, in the tasks module's own view. */
export const CHAT_TASKS_ASSIGNED_HREF = '/backend/tasks/assigned'
