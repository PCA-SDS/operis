export const metadata = {
  requireAuth: true,
  requireFeatures: ['tasks.view'],
  pageTitle: 'Completed',
  pageTitleKey: 'tasks.sidebar.completed',
  breadcrumb: [
    { label: 'Tasks', labelKey: 'tasks.nav.group', href: '/backend/tasks/today' },
    { label: 'Completed', labelKey: 'tasks.sidebar.completed' },
  ],
}
