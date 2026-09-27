import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'backend:topbar:actions': {
    widgetId: 'staff.injection.timer-sidebar-indicator',
    priority: 90,
  },
}

export default injectionTable
