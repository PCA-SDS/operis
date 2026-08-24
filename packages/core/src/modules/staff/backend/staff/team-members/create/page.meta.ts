export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.manage_team'],
  pageTitle: 'Add Team Member',
  pageTitleKey: 'staff.teamMembers.form.createTitle',
  pageGroup: 'Employees',
  pageGroupKey: 'staff.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Team Members', labelKey: 'staff.teamMembers.page.title', href: '/backend/staff/team-members' },
    { label: 'Add Team Member', labelKey: 'staff.teamMembers.form.createTitle' },
  ],
}
