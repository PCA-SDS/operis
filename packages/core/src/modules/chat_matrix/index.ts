import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'chat_matrix',
  title: 'Chat Matrix Transport',
  version: '0.1.0',
  description:
    'Maps Operis chat conversations onto Matrix rooms. Infrastructure for the chat transport; it renders nothing.',
  author: 'Operis',
  license: 'MIT',
  // Off for a new tenant. The transport is behind OM_CHAT_TRANSPORT and does
  // nothing until a homeserver is configured, so switching it on by default
  // would advertise a capability no deployment has yet.
  defaultEntitlement: 'disabled',
  category: 'Communication',
  requires: ['chat'],
}

export { features } from './acl'
