import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'tasks',
  title: 'Tasks',
  version: '0.1.0',
  description: 'Projects, boards, milestones and personal task views.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
