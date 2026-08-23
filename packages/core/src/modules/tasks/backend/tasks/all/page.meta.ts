export const metadata = {
  requireAuth: true,
  requireFeatures: ['tasks.view'],
  pageTitle: 'All Tasks',
  pageTitleKey: 'tasks.sidebar.allTasks',
  breadcrumb: [
    { label: 'Tasks', labelKey: 'tasks.nav.group', href: '/backend/tasks/today' },
    { label: 'All Tasks', labelKey: 'tasks.sidebar.allTasks' },
  ],
}
