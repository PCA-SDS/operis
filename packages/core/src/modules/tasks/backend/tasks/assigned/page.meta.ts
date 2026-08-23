export const metadata = {
  requireAuth: true,
  requireFeatures: ['tasks.view'],
  pageTitle: 'Assigned to Me',
  pageTitleKey: 'tasks.sidebar.assigned',
  breadcrumb: [
    { label: 'Tasks', labelKey: 'tasks.nav.group', href: '/backend/tasks/today' },
    { label: 'Assigned to Me', labelKey: 'tasks.sidebar.assigned' },
  ],
}
