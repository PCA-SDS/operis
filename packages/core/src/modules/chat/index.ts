import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'chat',
  title: 'Chat',
  version: '0.1.0',
  description: 'Private direct messaging between people in the same organization.',
  author: 'Operis',
  license: 'MIT',
  defaultEntitlement: 'enabled',
  category: 'Communication',
}

export { features } from './acl'
