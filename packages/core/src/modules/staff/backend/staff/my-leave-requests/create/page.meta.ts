export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.my_leave_requests.send'],
  pageTitle: 'New Leave Request',
  pageTitleKey: 'staff.leaveRequests.form.createTitle',
  pageGroup: 'Employees',
  pageGroupKey: 'staff.nav.group',
  navHidden: true,
  breadcrumb: [{ label: 'My Leave Requests', labelKey: 'staff.leaveRequests.my.title', href: '/backend/staff/my-leave-requests' }],
}
