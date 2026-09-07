export const metadata = {
  requireAuth: true,
  requireFeatures: ['tasks.view'],
  pageTitle: 'Assigned to Me',
  pageTitleKey: 'tasks.sidebar.assigned',
  pageGroup: 'Tasks',
  pageGroupKey: 'tasks.nav.group',
  pageOrder: 13,
  pagePriority: 13,
  icon: 'user-check',
  breadcrumb: [
    { label: 'Tasks', labelKey: 'tasks.nav.group', href: '/backend/tasks/today' },
    { label: 'Assigned to Me', labelKey: 'tasks.sidebar.assigned' },
  ],
}
