export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.view'],
  pageTitle: 'Phase L Integrations',
  pageTitleKey: 'example.menu.umesIntegrations',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  pageOrder: 20700,
  icon: 'link',
  breadcrumb: [
    { label: 'General Tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Phase L Integrations', labelKey: 'example.umes.integrations.title' },
  ],
}

export default metadata
