export const metadata = {
  requireAuth: true,
  requireFeatures: ['tasks.view'],
  pageTitle: 'All Tasks',
  pageTitleKey: 'tasks.sidebar.allTasks',
  pageGroup: 'Tasks',
  pageGroupKey: 'tasks.nav.group',
  pageOrder: 11,
  pagePriority: 11,
  icon: 'list',
  breadcrumb: [
    { label: 'Tasks', labelKey: 'tasks.nav.group', href: '/backend/tasks/today' },
    { label: 'All Tasks', labelKey: 'tasks.sidebar.allTasks' },
  ],
}
