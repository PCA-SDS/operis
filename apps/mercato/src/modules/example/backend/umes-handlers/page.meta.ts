export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.manage'],
  pageTitle: 'UMES Phase A-D Handlers',
  pageTitleKey: 'example.umes.handlers.title',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  pageOrder: 20500,
  icon: 'settings',
  breadcrumb: [
    { label: 'General Tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Phase A-D Handlers', labelKey: 'example.umes.handlers.title' },
  ],
}

export default metadata
