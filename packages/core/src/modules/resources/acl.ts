export const features = [
  { id: 'resources.view', title: 'View resources', module: 'resources' },
  {
    id: 'resources.manage_resources',
    title: 'Manage resources',
    module: 'resources',
    dependsOn: ['resources.view'],
  },
  {
    id: 'resources.areas.view',
    title: 'View resource areas',
    module: 'resources',
    dependsOn: ['resources.view'],
  },
  {
    id: 'resources.areas.manage',
    title: 'Manage resource areas',
    module: 'resources',
    dependsOn: ['resources.areas.view'],
  },
]

export default features
