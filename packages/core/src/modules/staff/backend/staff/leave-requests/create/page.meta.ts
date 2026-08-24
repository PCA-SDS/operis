export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.leave_requests.manage'],
  pageTitle: 'New Leave Request',
  pageTitleKey: 'staff.leaveRequests.form.createTitle',
  pageGroup: 'Employees',
  pageGroupKey: 'staff.nav.group',
  navHidden: true,
  breadcrumb: [{ label: 'Leave Requests', labelKey: 'staff.leaveRequests.page.title', href: '/backend/staff/leave-requests' }],
}
