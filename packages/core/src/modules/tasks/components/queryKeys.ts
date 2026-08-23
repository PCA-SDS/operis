// One place for every cache key the module uses. Grouped by root so a mutation
// can invalidate a whole family (`taskKeys.all`) without listing its members.

export const taskKeys = {
  all: ['tasks'] as const,
  projects: (params?: Record<string, unknown>) => ['tasks', 'projects', params ?? {}] as const,
  project: (id: string) => ['tasks', 'project', id] as const,
  inbox: () => ['tasks', 'inbox'] as const,
  board: (projectId: string) => ['tasks', 'board', projectId] as const,
  projectTasks: (projectId: string, params?: Record<string, unknown>) =>
    ['tasks', 'project-tasks', projectId, params ?? {}] as const,
  task: (id: string) => ['tasks', 'task', id] as const,
  myTasks: (params: Record<string, unknown>) => ['tasks', 'my-tasks', params] as const,
  calendar: (params: Record<string, unknown>) => ['tasks', 'calendar', params] as const,
  comments: (taskId: string, page: number) => ['tasks', 'comments', taskId, page] as const,
  docs: (projectId: string) => ['tasks', 'docs', projectId] as const,
  doc: (id: string) => ['tasks', 'doc', id] as const,
  milestones: (projectId: string) => ['tasks', 'milestones', projectId] as const,
  labels: () => ['tasks', 'labels'] as const,
  assignableUsers: () => ['tasks', 'assignable-users'] as const,
  assignmentOptions: () => ['tasks', 'assignment-options'] as const,
  teamMembers: () => ['tasks', 'team', 'members'] as const,
  teamMemberBoard: (userId: string) => ['tasks', 'team', 'board', userId] as const,
  teamMemberTasks: (userId: string, params: Record<string, unknown>) =>
    ['tasks', 'team', 'tasks', userId, params] as const,
}
