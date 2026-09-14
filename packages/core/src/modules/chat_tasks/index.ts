import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'chat_tasks',
  title: 'Chat Tasks',
  version: '0.1.0',
  description:
    'Create, assign and follow Tasks-module tasks from a chat conversation. Owns the link between a conversation and a task; owns no task rules of its own.',
  author: 'Operis',
  license: 'MIT',
  // On for a new tenant, because both halves are: a tenant that has chat and
  // tasks has no reason to be handed them unconnected. Withholding the module
  // from `tenant_modules` empties every spot it fills and leaves both modules
  // exactly as they were.
  defaultEntitlement: 'enabled',
  category: 'Operations',
  // Hard, both of them. There is nothing here without a conversation to read and
  // a task to point at, so an installation missing either should fail loudly at
  // provisioning rather than render empty panels.
  requires: ['chat', 'tasks'],
}

export default metadata
