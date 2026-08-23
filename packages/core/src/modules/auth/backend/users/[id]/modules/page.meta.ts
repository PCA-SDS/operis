export const metadata = {
  requireAuth: true,
  requireFeatures: ['auth.users.modules.view'],
  pageTitle: 'User Modules',
  pageTitleKey: 'auth.userModules.title',
  pageGroup: 'Users',
  pageGroupKey: 'auth.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Users', labelKey: 'auth.nav.users', href: '/backend/users' },
    { label: 'Modules', labelKey: 'auth.userModules.breadcrumb' },
  ],
}
