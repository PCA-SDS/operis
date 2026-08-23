import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Tasks module events.
 *
 * `clientBroadcast: true` bridges an event to open browsers over SSE (DOM Event
 * Bridge) — set on every write a live board or list must react to, so a task
 * moved by one operator reorders on everyone else's board.
 */
const events = [
  { id: 'tasks.project.created', label: 'Project Created', entity: 'project', category: 'crud', clientBroadcast: true },
  { id: 'tasks.project.updated', label: 'Project Updated', entity: 'project', category: 'crud', clientBroadcast: true },
  { id: 'tasks.project.archived', label: 'Project Archived', entity: 'project', category: 'lifecycle', clientBroadcast: true },
  { id: 'tasks.project.deleted', label: 'Project Deleted', entity: 'project', category: 'crud', clientBroadcast: true },

  { id: 'tasks.task.created', label: 'Task Created', entity: 'task', category: 'crud', clientBroadcast: true },
  { id: 'tasks.task.updated', label: 'Task Updated', entity: 'task', category: 'crud', clientBroadcast: true },
  { id: 'tasks.task.deleted', label: 'Task Deleted', entity: 'task', category: 'crud', clientBroadcast: true },
  { id: 'tasks.task.moved', label: 'Task Moved On Board', entity: 'task', category: 'lifecycle', clientBroadcast: true },
  { id: 'tasks.task.completed', label: 'Task Completed', entity: 'task', category: 'lifecycle', clientBroadcast: true },
  { id: 'tasks.task.reopened', label: 'Task Reopened', entity: 'task', category: 'lifecycle', clientBroadcast: true },
  { id: 'tasks.task.assigned', label: 'Task Assignees Changed', entity: 'task', category: 'lifecycle', clientBroadcast: true },

  { id: 'tasks.comment.created', label: 'Task Comment Created', entity: 'comment', category: 'crud', clientBroadcast: true },
  { id: 'tasks.comment.updated', label: 'Task Comment Updated', entity: 'comment', category: 'crud', clientBroadcast: true },
  { id: 'tasks.comment.deleted', label: 'Task Comment Deleted', entity: 'comment', category: 'crud', clientBroadcast: true },

  { id: 'tasks.milestone.created', label: 'Milestone Created', entity: 'milestone', category: 'crud', clientBroadcast: true },
  { id: 'tasks.milestone.updated', label: 'Milestone Updated', entity: 'milestone', category: 'crud', clientBroadcast: true },
  { id: 'tasks.milestone.deleted', label: 'Milestone Deleted', entity: 'milestone', category: 'crud', clientBroadcast: true },

  { id: 'tasks.label.created', label: 'Label Created', entity: 'label', category: 'crud', clientBroadcast: true },
  { id: 'tasks.label.updated', label: 'Label Updated', entity: 'label', category: 'crud', clientBroadcast: true },
  { id: 'tasks.label.deleted', label: 'Label Deleted', entity: 'label', category: 'crud', clientBroadcast: true },

  { id: 'tasks.doc.created', label: 'Project Doc Created', entity: 'doc', category: 'crud', clientBroadcast: true },
  { id: 'tasks.doc.updated', label: 'Project Doc Updated', entity: 'doc', category: 'crud', clientBroadcast: true },
  { id: 'tasks.doc.deleted', label: 'Project Doc Deleted', entity: 'doc', category: 'crud', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'tasks',
  events,
})

export const emitTasksEvent = eventsConfig.emit

export type TasksEventId = (typeof events)[number]['id']

export default eventsConfig
