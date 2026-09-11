import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'email',
  title: 'Email Templates',
  version: '0.1.0',
  description: 'Tenant-owned email templates and accounting email defaults.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
  defaultEntitlement: 'disabled',
  category: 'Communication',
}

export { features } from './acl'
