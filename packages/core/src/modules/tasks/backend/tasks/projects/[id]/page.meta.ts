export const metadata = {
  requireAuth: true,
  requireFeatures: ['tasks.projects.view'],
  pageTitle: 'Project',
  pageTitleKey: 'tasks.nav.project',
  breadcrumb: [
    { label: 'Projects', labelKey: 'tasks.nav.projects', href: '/backend/tasks/projects' },
    { label: 'Project', labelKey: 'tasks.nav.project' },
  ],
}
