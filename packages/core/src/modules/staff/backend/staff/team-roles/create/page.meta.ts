export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.manage_team'],
  pageTitle: 'Add Team Role',
  pageTitleKey: 'staff.teamRoles.form.createTitle',
  pageGroup: 'Employees',
  pageGroupKey: 'staff.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Team Roles', labelKey: 'staff.teamRoles.page.title', href: '/backend/staff/team-roles' },
    { label: 'Add Team Role', labelKey: 'staff.teamRoles.form.createTitle' },
  ],
}
