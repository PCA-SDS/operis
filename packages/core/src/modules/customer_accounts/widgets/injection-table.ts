import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

const accountStatusWidget = {
  widgetId: 'customer_accounts.injection.account-status',
  kind: 'group',
  column: 2,
  groupLabel: 'customer_accounts.widgets.accountStatus',
  priority: 200,
} as const

// Column 1 on purpose (#4400): any column-2 group makes CrudForm switch the
// company detail page to the narrow 7fr/3fr two-column layout, compressing the
// left-side groups. Portal users belongs in the left stack as a full-width row.
const companyUsersWidget = {
  widgetId: 'customer_accounts.injection.company-users',
  kind: 'group',
  column: 1,
  groupLabel: 'customer_accounts.widgets.portalUsers',
  priority: 200,
} as const

export const injectionTable: ModuleInjectionTable = {
  'customers.person': [accountStatusWidget],
  'crud-form:customers.person': [accountStatusWidget],
  'customers.company': [companyUsersWidget],
  'crud-form:customers.company': [companyUsersWidget],
}

export default injectionTable
