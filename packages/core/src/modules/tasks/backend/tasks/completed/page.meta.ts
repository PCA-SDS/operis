export const metadata = {
  requireAuth: true,
  requireFeatures: ['tasks.view'],
  pageTitle: 'Completed',
  pageTitleKey: 'tasks.sidebar.completed',
  pageGroup: 'Tasks',
  pageGroupKey: 'tasks.nav.group',
  pageOrder: 14,
  pagePriority: 14,
  icon: 'check-circle-2',
  breadcrumb: [
    { label: 'Tasks', labelKey: 'tasks.nav.group', href: '/backend/tasks/today' },
    { label: 'Completed', labelKey: 'tasks.sidebar.completed' },
  ],
}
