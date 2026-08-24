export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.manage'],
  pageTitle: 'UMES Next Phases',
  pageTitleKey: 'example.umes.next.page.title',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  pageOrder: 20510,
  icon: 'sparkles',
  breadcrumb: [
    { label: 'General Tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'UMES Next Phases', labelKey: 'example.umes.next.page.title' },
  ],
}

export default metadata
