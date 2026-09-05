import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['email.*'],
    employee: ['email.templates.view'],
  },
}

export default setup
