export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.manage'],
  pageTitle: 'Create Todo',
  pageTitleKey: 'example.todos.create.title',
  pageGroup: 'Work Plan',
  pageGroupKey: 'example.workPlan.nav.group',
  pageOrder: 121,
  icon: 'file-text',
  breadcrumb: [
    { label: 'General Tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Create', labelKey: 'example.todos.create.title' },
  ],
}
