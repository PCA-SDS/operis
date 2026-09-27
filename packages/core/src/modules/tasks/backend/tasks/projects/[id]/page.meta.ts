export const metadata = {
  requireAuth: true,
  requireFeatures: ['tasks.projects.view'],
  moduleSidebar: false,
  pageTitle: 'Project',
  pageTitleKey: 'tasks.nav.project',
  breadcrumb: [
    { label: 'Projects', labelKey: 'tasks.nav.projects', href: '/backend/tasks/projects' },
    { label: 'Project', labelKey: 'tasks.nav.project' },
  ],
}
