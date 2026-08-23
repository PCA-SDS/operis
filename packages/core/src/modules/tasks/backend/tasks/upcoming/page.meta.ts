export const metadata = {
  requireAuth: true,
  requireFeatures: ['tasks.view'],
  pageTitle: 'Upcoming',
  pageTitleKey: 'tasks.sidebar.upcoming',
  breadcrumb: [
    { label: 'Tasks', labelKey: 'tasks.nav.group', href: '/backend/tasks/today' },
    { label: 'Upcoming', labelKey: 'tasks.sidebar.upcoming' },
  ],
}
