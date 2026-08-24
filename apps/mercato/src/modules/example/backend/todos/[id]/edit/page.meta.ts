export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.manage'],
  pageTitle: 'Edit Todo',
  pageTitleKey: 'example.todos.edit.title',
  pageGroup: 'Work Plan',
  pageGroupKey: 'example.workPlan.nav.group',
  breadcrumb: [
    { label: 'General Tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Edit', labelKey: 'example.todos.edit.title' },
  ],
}
