export const metadata = {
  requireAuth: true,
  requireFeatures: ['planner.manage_availability'],
  pageTitle: 'Create Schedule',
  pageTitleKey: 'planner.availabilityRuleSets.form.createTitle',
  pageGroup: 'Configuration',
  pageGroupKey: 'backend.nav.configuration',
  navHidden: true,
  breadcrumb: [
    { label: 'Availability Schedules', labelKey: 'planner.availabilityRuleSets.page.title', href: '/backend/planner/availability-rulesets' },
    { label: 'Create Schedule', labelKey: 'planner.availabilityRuleSets.form.createTitle' },
  ],
}
