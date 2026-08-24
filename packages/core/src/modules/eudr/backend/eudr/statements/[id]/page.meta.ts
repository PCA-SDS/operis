export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.statements.manage'],
  pageTitle: 'Edit Statement',
  pageTitleKey: 'eudr.statements.edit.title',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'EUDR', labelKey: 'eudr.nav.module', href: '/backend/eudr' },
    { label: 'Statements', labelKey: 'eudr.nav.statements', href: '/backend/eudr/statements' },
    { label: 'Edit Statement', labelKey: 'eudr.statements.edit.title' },
  ],
}
