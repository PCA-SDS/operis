export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.risk.manage'],
  pageTitle: 'Edit Risk Assessment',
  pageTitleKey: 'eudr.riskAssessments.edit.title',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'EUDR', labelKey: 'eudr.nav.module', href: '/backend/eudr' },
    { label: 'Risk Assessments', labelKey: 'eudr.nav.riskAssessments', href: '/backend/eudr/risk-assessments' },
    { label: 'Edit Risk Assessment', labelKey: 'eudr.riskAssessments.edit.title' },
  ],
}
