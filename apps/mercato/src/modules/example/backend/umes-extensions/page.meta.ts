export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.view'],
  pageTitle: 'Phase E-H Handlers',
  pageTitleKey: 'example.menu.umesExtensions',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  pageOrder: 20600,
  icon: 'shapes',
  breadcrumb: [
    { label: 'General Tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Phase E-H Extensions', labelKey: 'example.umes.extensions.title' },
  ],
}

export default metadata
