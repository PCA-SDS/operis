export const features = [
  { id: 'tasks.view', title: 'View tasks', module: 'tasks' },
  {
    id: 'tasks.create',
    title: 'Create tasks',
    module: 'tasks',
    dependsOn: ['tasks.view'],
  },
  {
    id: 'tasks.edit',
    title: 'Edit tasks',
    module: 'tasks',
    dependsOn: ['tasks.view'],
  },
  {
    id: 'tasks.delete',
    title: 'Delete tasks',
    module: 'tasks',
    dependsOn: ['tasks.view'],
  },
  {
    id: 'tasks.assign',
    title: 'Assign tasks to people and roles',
    module: 'tasks',
    dependsOn: ['tasks.view'],
  },
  {
    id: 'tasks.projects.view',
    title: 'View projects',
    module: 'tasks',
    dependsOn: ['tasks.view'],
  },
  {
    id: 'tasks.projects.manage',
    title: 'Manage projects',
    module: 'tasks',
    dependsOn: ['tasks.projects.view'],
  },
  {
    id: 'tasks.milestones.manage',
    title: 'Manage milestones',
    module: 'tasks',
    dependsOn: ['tasks.projects.view'],
  },
  {
    id: 'tasks.labels.manage',
    title: 'Manage the label catalog',
    module: 'tasks',
    dependsOn: ['tasks.view'],
  },
  {
    id: 'tasks.docs.view',
    title: 'View project docs',
    module: 'tasks',
    dependsOn: ['tasks.projects.view'],
  },
  {
    id: 'tasks.docs.manage',
    title: 'Manage project docs',
    module: 'tasks',
    dependsOn: ['tasks.docs.view'],
  },
  {
    id: 'tasks.comments.create',
    title: 'Comment on tasks',
    module: 'tasks',
    dependsOn: ['tasks.view'],
  },
  {
    id: 'tasks.comments.manage',
    title: "Edit and delete anyone's task comments",
    module: 'tasks',
    dependsOn: ['tasks.comments.create'],
  },
  {
    id: 'tasks.team.view',
    title: "View the team's tasks",
    module: 'tasks',
    dependsOn: ['tasks.view'],
  },
]

export default features
