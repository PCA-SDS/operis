import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['invoice.*'],
    employee: [
      'invoice.view',
      'invoice.manage',
      'invoice.payment_confirmations.manage',
    ],
  },
}

export default setup
