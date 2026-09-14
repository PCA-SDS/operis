export const features = [
  { id: 'appointments.view', title: 'View appointments', module: 'appointments' },
  { id: 'appointments.create', title: 'Create appointments', module: 'appointments' },
  { id: 'appointments.manage', title: 'Manage appointments and statuses', module: 'appointments' },
  {
    id: 'appointments.settings.manage',
    title: 'Manage appointment settings (status catalog)',
    module: 'appointments',
  },
  {
    id: 'appointments.seat_planner.view',
    title: 'View seat planner',
    module: 'appointments',
    dependsOn: ['appointments.view'],
  },
  {
    id: 'appointments.seat_planner.manage',
    title: 'Manage seat assignments',
    module: 'appointments',
    dependsOn: ['appointments.seat_planner.view', 'appointments.manage'],
  },
]

export default features
