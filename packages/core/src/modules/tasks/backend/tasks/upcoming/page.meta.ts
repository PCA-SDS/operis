export const metadata = {
  requireAuth: true,
  requireFeatures: ['tasks.view'],
  pageTitle: 'Upcoming',
  pageTitleKey: 'tasks.sidebar.upcoming',
  pageGroup: 'Tasks',
  pageGroupKey: 'tasks.nav.group',
  pageOrder: 12,
  pagePriority: 12,
  icon: 'calendar',
  breadcrumb: [
    { label: 'Tasks', labelKey: 'tasks.nav.group', href: '/backend/tasks/today' },
    { label: 'Upcoming', labelKey: 'tasks.sidebar.upcoming' },
  ],
}
